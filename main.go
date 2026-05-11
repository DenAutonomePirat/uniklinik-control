package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// Config represents the application configuration
type Config struct {
	Room    []Room   `yaml:"room"`
	Cameras []Camera `yaml:"cameras"`
	Server  struct {
		Port string `yaml:"port"`
		Host string `yaml:"host"`
	} `yaml:"server"`
	LTC struct {
		FilePath       string `yaml:"filePath"`       // Path to LTC timecode wav file
		PreRollSeconds int    `yaml:"preRollSeconds"` // Pre-roll seconds before starting recording
	} `yaml:"ltc"`
}

// Room represents the clinical room/therapy room identifier
type Room struct {
	Name string `yaml:"name"`
}

// Camera represents a Blackmagic camera configuration
type Camera struct {
	Name     string `yaml:"name"`
	Hostname string `yaml:"hostname"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
}

// CameraStatus represents the status of a camera
type CameraStatus struct {
	Name                 string  `json:"name"`
	Hostname             string  `json:"hostname"`
	Reachable            bool    `json:"reachable"`
	Recording            bool    `json:"recording"`
	USBStatus            string  `json:"usbStatus"`
	RemainingRecordHours float64 `json:"remainingRecordHours"`
}

// WorkingSetItem represents a single storage device in the workingset
type WorkingSetItem struct {
	ActiveDisk          bool   `json:"activeDisk"`
	ClipCount           int    `json:"clipCount"`
	DeviceName          string `json:"deviceName"`
	Index               int    `json:"index"`
	RemainingRecordTime int    `json:"remainingRecordTime"`
	RemainingSpace      int64  `json:"remainingSpace"`
	TotalSpace          int64  `json:"totalSpace"`
	Volume              string `json:"volume"`
}

// WorkingSet represents the complete workingset response from the API
type WorkingSet struct {
	Size       int              `json:"size"`
	WorkingSet []WorkingSetItem `json:"workingset"`
}

// SessionInfo represents information about a recording session
type SessionInfo struct {
	ClientID       string `json:"clientId"`
	PsychologistID string `json:"psychologistId"`
	SessionNumber  string `json:"sessionNumber"`
}

var config Config
var templates *template.Template
var httpClient *http.Client
var formatHTTPClient *http.Client

func init() {
	// Load configuration
	configFile, err := os.ReadFile("config.yaml")
	if err != nil {
		log.Fatalf("Error reading config file: %v", err)
	}

	err = yaml.Unmarshal(configFile, &config)
	if err != nil {
		log.Fatalf("Error parsing config file: %v", err)
	}

	// Load templates
	templates = template.Must(template.ParseGlob(filepath.Join("templates", "*.html")))

	// Initialize HTTP client with timeout
	httpClient = &http.Client{
		Timeout: 2 * time.Second,
	}

	// Dedicated client for disk format operations — formatting can take several minutes.
	formatHTTPClient = &http.Client{
		Timeout: 5 * time.Minute,
	}
}

func main() {
	// Set up routes
	http.HandleFunc("/", indexHandler)
	http.HandleFunc("/api/cameras", getCamerasHandler)
	http.HandleFunc("/api/camera/record", toggleRecordHandler)
	http.HandleFunc("/api/camera/usb-status", getUSBStatusHandler)
	http.HandleFunc("/api/session/start", startSessionHandler)
	http.HandleFunc("/api/session/end", endSessionHandler)
	http.HandleFunc("/api/disks/format", formatDisksHandler)

	// Serve static files
	fs := http.FileServer(http.Dir("static"))
	http.Handle("/static/", http.StripPrefix("/static/", fs))

	// Start server
	addr := fmt.Sprintf("%s:%s", config.Server.Host, config.Server.Port)
	log.Printf("Server starting on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func indexHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	err := templates.ExecuteTemplate(w, "index.html", config)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func getCamerasHandler(w http.ResponseWriter, r *http.Request) {
	statuses := make([]CameraStatus, len(config.Cameras))

	for i, camera := range config.Cameras {
		// Initialize with default values
		status := CameraStatus{
			Name:                 camera.Name,
			Hostname:             camera.Hostname,
			Reachable:            true, // Assume reachable until proven otherwise
			Recording:            false,
			USBStatus:            "Unknown",
			RemainingRecordHours: 0,
		}

		// Check if camera is reachable by getting recording status
		recording, err := getCameraRecordingStatus(camera)
		if err != nil {
			// If there's an error, the camera is likely not reachable
			status.Reachable = false
		} else {
			status.Recording = recording

			// Get USB status and remaining time in a single call
			usbStatus, remainingHours, err := getCameraStorageInfo(camera)
			if err == nil {
				status.USBStatus = usbStatus
				status.RemainingRecordHours = remainingHours
			}
		}

		statuses[i] = status
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(statuses)
}

func toggleRecordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var requestData struct {
		Hostname string `json:"hostname"`
		Record   bool   `json:"record"`
	}

	err := json.NewDecoder(r.Body).Decode(&requestData)
	if err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Find the camera
	var targetCamera Camera
	found := false
	for _, camera := range config.Cameras {
		if camera.Hostname == requestData.Hostname {
			targetCamera = camera
			found = true
			break
		}
	}

	if !found {
		http.Error(w, "Camera not found", http.StatusNotFound)
		return
	}

	// Toggle recording
	success, err := setCameraRecording(targetCamera, requestData.Record)
	if err != nil || !success {
		http.Error(w, fmt.Sprintf("Failed to set recording state: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func getUSBStatusHandler(w http.ResponseWriter, r *http.Request) {
	hostname := r.URL.Query().Get("hostname")
	if hostname == "" {
		http.Error(w, "Hostname parameter required", http.StatusBadRequest)
		return
	}

	// Find the camera
	var targetCamera Camera
	found := false
	for _, camera := range config.Cameras {
		if camera.Hostname == hostname {
			targetCamera = camera
			found = true
			break
		}
	}

	if !found {
		http.Error(w, "Camera not found", http.StatusNotFound)
		return
	}

	// Get USB status and remaining time
	usbStatus, remainingHours, err := getCameraStorageInfo(targetCamera)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get USB status: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"usbStatus":            usbStatus,
		"remainingRecordHours": remainingHours,
	})
}

func startSessionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse session info from request
	var sessionInfo SessionInfo
	err := json.NewDecoder(r.Body).Decode(&sessionInfo)
	if err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate field formats
	writeValidationError := func(msg string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": msg})
	}
	if !isFourDigitNumber(sessionInfo.PsychologistID) {
		writeValidationError("Psykolog ID skal være et 4-cifret tal")
		return
	}
	if !isFourDigitNumber(sessionInfo.ClientID) {
		writeValidationError("Klient ID skal være et 4-cifret tal")
		return
	}
	if !isValidSessionNumber(sessionInfo.SessionNumber) {
		writeValidationError("Sessions nummer skal være et tal mellem 1 og 99")
		return
	}
	// If a session is already running, return an error
	if activeLTCProcess != nil && activeLTCProcess.Process != nil {
		http.Error(w, "A session is already running", http.StatusConflict)
		return
	}

	// Log the session information
	log.Printf("Starting session - Client: %s, Psychologist: %s, Session: %s",
		sessionInfo.ClientID, sessionInfo.PsychologistID, sessionInfo.SessionNumber)

	// Validate all cameras before starting the process
	validCameras := make([]Camera, 0)
	invalidCameras := make([]string, 0)
	for _, camera := range config.Cameras {
		recording, err := getCameraRecordingStatus(camera)
		if err != nil {
			invalidCameras = append(invalidCameras, camera.Name+" (unreachable)")
			continue
		}
		if recording {
			invalidCameras = append(invalidCameras, camera.Name+" (already recording)")
			continue
		}
		usbStatus, remainingHours, err := getCameraStorageInfo(camera)
		if err != nil || usbStatus != "Connected" {
			invalidCameras = append(invalidCameras, camera.Name+" (USB not connected)")
			continue
		}
		if remainingHours < 0.5 {
			invalidCameras = append(invalidCameras, fmt.Sprintf("%s (only %.1f hours remaining)", camera.Name, remainingHours))
			continue
		}

		// Camera is valid for recording
		validCameras = append(validCameras, camera)
	}

	// If no cameras are valid, return an error
	if len(validCameras) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":        false,
			"message":        "No valid cameras available for recording",
			"invalidCameras": invalidCameras,
		})
		return
	}

	// Compute the recording date once so all cameras share the same date string
	// even if the pre-roll crosses midnight.
	recordingDate := time.Now().Format("20060102")

	// Start LTC and recording process in a goroutine
	go func() {
		preRollSeconds := config.LTC.PreRollSeconds
		if preRollSeconds <= 0 {
			preRollSeconds = 5 // default if not specified
		}

		// Start LTC playback
		cmd, err := playLTC()
		if err != nil {
			log.Printf("Failed to start LTC playback: %v", err)
			// Continue without LTC if it fails
		}

		log.Printf("Pre-roll started, waiting %d seconds before recording", preRollSeconds)
		time.Sleep(time.Duration(preRollSeconds) * time.Second)
		log.Printf("Pre-roll complete, starting recording on %d cameras", len(validCameras))

		// Start recording on all valid cameras using the session clip name.
		// Track per-camera success so we can roll back if any camera fails.
		results := make([]bool, len(validCameras))
		var wg sync.WaitGroup
		for i, camera := range validCameras {
			wg.Add(1)
			go func(idx int, cam Camera) {
				defer wg.Done()
				clipName := buildClipName(cam, sessionInfo, recordingDate)
				if err := startCameraRecording(cam, clipName); err != nil {
					log.Printf("Failed to start recording on %s: %v", cam.Name, err)
				} else {
					log.Printf("Started recording on %s — clip: %s", cam.Name, clipName)
					results[idx] = true // safe: each goroutine writes its own index
				}
			}(i, camera)
		}

		// Wait for all camera operations to complete
		wg.Wait()

		// Count how many cameras actually started recording.
		successCount := 0
		for _, ok := range results {
			if ok {
				successCount++
			}
		}

		// Both-or-none policy: if any camera failed, roll back everything.
		if successCount < len(validCameras) {
			log.Printf("Only %d/%d cameras started recording; rolling back session", successCount, len(validCameras))

			// Stop any camera that did start, in parallel.
			var rwg sync.WaitGroup
			for i, camera := range validCameras {
				if results[i] {
					rwg.Add(1)
					go func(cam Camera) {
						defer rwg.Done()
						if err := stopCameraRecording(cam); err != nil {
							log.Printf("Rollback: failed to stop recording on %s: %v", cam.Name, err)
						} else {
							log.Printf("Rollback: stopped recording on %s", cam.Name)
						}
					}(camera)
				}
			}
			rwg.Wait()

			// Kill LTC — resets activeLTCProcess to nil, unblocking future starts.
			stopLTC()
			log.Printf("Session rolled back; LTC stopped")
			return
		}

		// Stage 2: Verify cameras are actually recording.
		// The Blackmagic API may return 204 (accepted) even when the camera silently
		// rejects a duplicate clip name at the hardware level. Poll actual status
		// after a brief settle period to catch this silent-failure case.
		log.Printf("All %d API calls succeeded; verifying actual recording state", successCount)
		time.Sleep(1 * time.Second)

		type verifyResult struct {
			camera    Camera
			recording bool
		}
		verifyCh := make(chan verifyResult, len(validCameras))
		for _, camera := range validCameras {
			go func(cam Camera) {
				recording, err := getCameraRecordingStatus(cam)
				if err != nil {
					log.Printf("Verify: failed to get recording status for %s: %v", cam.Name, err)
					recording = false
				}
				verifyCh <- verifyResult{cam, recording}
			}(camera)
		}

		actuallyRecording := 0
		var notRecording []Camera
		for range validCameras {
			r := <-verifyCh
			if r.recording {
				actuallyRecording++
			} else {
				notRecording = append(notRecording, r.camera)
			}
		}

		if actuallyRecording < len(validCameras) {
			log.Printf("Verify: only %d/%d cameras are actually recording (clip name conflict?); rolling back", actuallyRecording, len(validCameras))

			// Stop any camera that is recording.
			var rwg sync.WaitGroup
			for _, camera := range validCameras {
				isRecording := true
				for _, nc := range notRecording {
					if nc.Name == camera.Name {
						isRecording = false
						break
					}
				}
				if isRecording {
					rwg.Add(1)
					go func(cam Camera) {
						defer rwg.Done()
						if err := stopCameraRecording(cam); err != nil {
							log.Printf("Verify rollback: failed to stop recording on %s: %v", cam.Name, err)
						} else {
							log.Printf("Verify rollback: stopped recording on %s", cam.Name)
						}
					}(camera)
				}
			}
			rwg.Wait()

			// Kill LTC — resets activeLTCProcess to nil, unblocking future starts.
			stopLTC()
			log.Printf("Session rolled back after verification; LTC stopped")
			return
		}

		log.Printf("All %d cameras confirmed recording", actuallyRecording)

		// Wait for LTC playback to complete if it was started
		if cmd != nil && cmd.Process != nil {
			log.Printf("Waiting for LTC playback to complete")
			err := cmd.Wait()
			if err != nil {
				log.Printf("LTC playback ended with error: %v", err)
			} else {
				log.Printf("LTC playback completed successfully")
			}
		}
	}()

	// Immediately return a response to the client
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"message":        "Session started with pre-roll",
		"preRollSeconds": config.LTC.PreRollSeconds,
		"validCameras":   len(validCameras),
	})
}

// Helper functions to interact with the Blackmagic API

// makeAPIRequest is a helper function to make HTTP requests to the camera API
func makeAPIRequest(camera Camera, endpoint string, method string, body io.Reader) (*http.Response, error) {
	url := fmt.Sprintf("http://%s%s", camera.Hostname, endpoint)

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return httpClient.Do(req)
}

// buildClipName constructs the clip filename for a recording session:
//
//	<PsychologistID>_<ClientID>_<SessionNumber>_<YYYYMMDD>_<Room>_<CameraName>
//
// date is passed in (computed once before the pre-roll) so both cameras
// always get the same date string regardless of midnight rollovers.
// isFourDigitNumber returns true if s is exactly 4 ASCII digit characters.
func isFourDigitNumber(s string) bool {
	if len(s) != 4 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// isValidSessionNumber returns true if s parses to an integer in [1, 99].
func isValidSessionNumber(s string) bool {
	n, err := strconv.Atoi(s)
	if err != nil {
		return false
	}
	return n >= 1 && n <= 99
}

func buildClipName(camera Camera, session SessionInfo, date string) string {
	n, _ := strconv.Atoi(session.SessionNumber)
	paddedSession := fmt.Sprintf("%02d", n)
	return strings.Join([]string{
		session.PsychologistID,
		session.ClientID,
		paddedSession,
		date,
		config.Room[0].Name,
		camera.Name,
	}, "_")
}

// startCameraRecording starts recording on the camera using POST /transports/0/record
// with an explicit clipName so the filename on disk follows the session naming convention.
func startCameraRecording(camera Camera, clipName string) error {
	payload := map[string]string{
		"clipName": clipName,
	}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal record payload: %w", err)
	}

	resp, err := makeAPIRequest(camera, "/control/api/v1/transports/0/record", http.MethodPost, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("start recording on %s: %w", camera.Name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("start recording on %s returned %d: %s", camera.Name, resp.StatusCode, string(body))
	}
	return nil
}

// stopCameraRecording stops recording on the camera.
func stopCameraRecording(camera Camera) error {
	data := map[string]bool{"recording": false}
	jsonData, _ := json.Marshal(data)

	resp, err := makeAPIRequest(camera, "/control/api/v1/transports/0/record", http.MethodPut, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("stop recording on %s: %w", camera.Name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("stop recording on %s returned %d: %s", camera.Name, resp.StatusCode, string(body))
	}
	return nil
}

func getCameraRecordingStatus(camera Camera) (bool, error) {
	resp, err := makeAPIRequest(camera, "/control/api/v1/transports/0/record", http.MethodGet, nil)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("API returned status code %d", resp.StatusCode)

	}

	var result struct {
		Recording bool `json:"recording"`
	}

	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return false, err
	}

	return result.Recording, nil
}

func setCameraRecording(camera Camera, record bool) (bool, error) {
	data := map[string]bool{
		"recording": record,
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return false, err
	}

	resp, err := makeAPIRequest(camera, "/control/api/v1/transports/0/record", http.MethodPut, bytes.NewBuffer(jsonData))
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return true, nil
	}

	body, _ := io.ReadAll(resp.Body)
	return false, fmt.Errorf("API returned status code %d: %s", resp.StatusCode, string(body))
}

func getCameraStorageInfo(camera Camera) (string, float64, error) {
	resp, err := makeAPIRequest(camera, "/control/api/v1/media/workingset", http.MethodGet, nil)
	if err != nil {
		return "Unknown", 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "Unknown", 0, fmt.Errorf("API returned status code %d", resp.StatusCode)
	}

	// Parse the response using our defined structs
	var workingSet WorkingSet
	err = json.NewDecoder(resp.Body).Decode(&workingSet)
	if err != nil {
		log.Printf("Error decoding workingset response: %v", err)
		return "Unknown", 0, err
	}

	// Default values
	usbStatus := "Not Connected"
	var remainingHours float64 = 0

	// Check if there are any active USB devices
	for _, item := range workingSet.WorkingSet {
		if item.ActiveDisk {
			usbStatus = "Connected"
			// Convert from seconds to hours
			remainingHours = float64(item.RemainingRecordTime) / 3600.0
			break
		}
	}

	return usbStatus, remainingHours, nil
}

// setSlateNextClip, clearSlateNextClip and applySlateToAllCameras removed —
// session identification is fully covered by the clip filename set via
// POST /transports/0/record { clipName: "TERAPI1_CAMn_..." }.

// getActiveDiskName returns the deviceName of the active disk on the given camera.
// It queries the workingset and returns an error if no active disk is present.
func getActiveDiskName(camera Camera) (string, error) {
	resp, err := makeAPIRequest(camera, "/control/api/v1/media/workingset", http.MethodGet, nil)
	if err != nil {
		return "", fmt.Errorf("workingset request to %s: %w", camera.Name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("workingset on %s returned %d", camera.Name, resp.StatusCode)
	}

	var workingSet WorkingSet
	if err := json.NewDecoder(resp.Body).Decode(&workingSet); err != nil {
		return "", fmt.Errorf("decode workingset from %s: %w", camera.Name, err)
	}

	for _, item := range workingSet.WorkingSet {
		if item.ActiveDisk && item.DeviceName != "" {
			return item.DeviceName, nil
		}
	}
	return "", fmt.Errorf("no active disk found on %s", camera.Name)
}

// formatCameraDisk formats the active disk on a single camera to ExFAT using the
// two-step Blackmagic API: GET a single-use key, then PUT the format request.
// The volume name is set to camera.Name.
func formatCameraDisk(camera Camera) error {
	deviceName, err := getActiveDiskName(camera)
	if err != nil {
		return err
	}

	// Step 1: retrieve the single-use format key.
	keyEndpoint := fmt.Sprintf("/control/api/v1/media/devices/%s/doformat", deviceName)
	resp, err := makeAPIRequest(camera, keyEndpoint, http.MethodGet, nil)
	if err != nil {
		return fmt.Errorf("get format key from %s: %w", camera.Name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("get format key on %s returned %d: %s", camera.Name, resp.StatusCode, string(body))
	}

	var keyResp struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&keyResp); err != nil {
		return fmt.Errorf("decode format key from %s: %w", camera.Name, err)
	}
	if keyResp.Key == "" {
		return fmt.Errorf("empty format key returned by %s", camera.Name)
	}

	// Step 2: execute the format using the single-use key.
	// Uses formatHTTPClient — disk formatting can take several minutes.
	formatPayload := map[string]string{
		"key":        keyResp.Key,
		"filesystem": "ExFAT",
		"volume":     camera.Name,
	}
	jsonData, err := json.Marshal(formatPayload)
	if err != nil {
		return fmt.Errorf("marshal format payload: %w", err)
	}

	url := fmt.Sprintf("http://%s%s", camera.Hostname, keyEndpoint)
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("build format request for %s: %w", camera.Name, err)
	}
	req.Header.Set("Content-Type", "application/json")

	fmtResp, err := formatHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("format PUT on %s: %w", camera.Name, err)
	}
	defer fmtResp.Body.Close()

	if fmtResp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(fmtResp.Body)
		return fmt.Errorf("format on %s returned %d: %s", camera.Name, fmtResp.StatusCode, string(body))
	}

	log.Printf("Disk on %s formatted to ExFAT, volume name: %q", camera.Name, camera.Name)
	return nil
}

// formatDisksHandler handles POST /api/disks/format.
// It validates that no camera is recording and all cameras have a disk connected,
// then formats both camera disks concurrently.
func formatDisksHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Guard: validate all cameras before formatting.
	var guardErrors []string
	for _, camera := range config.Cameras {
		recording, err := getCameraRecordingStatus(camera)
		if err != nil {
			guardErrors = append(guardErrors, camera.Name+" (unreachable)")
			continue
		}
		if recording {
			guardErrors = append(guardErrors, camera.Name+" (currently recording — stop before formatting)")
			continue
		}
		if _, err = getActiveDiskName(camera); err != nil {
			guardErrors = append(guardErrors, camera.Name+" (no active disk connected)")
		}
	}

	if len(guardErrors) > 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Cannot format: " + strings.Join(guardErrors, "; "),
		})
		return
	}

	log.Printf("Formatting disks on %d cameras", len(config.Cameras))

	type result struct {
		name string
		err  error
	}
	results := make(chan result, len(config.Cameras))

	for _, cam := range config.Cameras {
		go func(c Camera) {
			results <- result{name: c.Name, err: formatCameraDisk(c)}
		}(cam)
	}

	var errs []string
	for range config.Cameras {
		if r := <-results; r.err != nil {
			errs = append(errs, r.err.Error())
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if len(errs) > 0 {
		log.Printf("Disk format errors: %s", strings.Join(errs, "; "))
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Format failed: " + strings.Join(errs, "; "),
		})
		return
	}

	log.Printf("All disks formatted successfully")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Both disks formatted successfully",
	})
}

// Global variable to track the active LTC process
var activeLTCProcess *exec.Cmd

// playLTC plays the LTC timecode audio file
func playLTC() (cmd *exec.Cmd, err error) {
	// Check if the LTC file exists
	if _, err := os.Stat(config.LTC.FilePath); os.IsNotExist(err) {
		log.Printf("LTC audio file not found: %s", config.LTC.FilePath)
		return nil, err
	}

	// Play the audio file using ffplay (assuming it's installed)
	// -nodisp: no display
	// -autoexit: exit when the file is done playing
	// -loglevel quiet: suppress output messages
	// -loop 0: loop indefinitely
	cmd = exec.Command("ffplay", "-nodisp", "-loop", "0", "-loglevel", "quiet", config.LTC.FilePath)

	// Start the command without waiting for it to complete
	err = cmd.Start()
	if err != nil {
		log.Printf("Failed to start LTC playback: %v", err)
		return nil, err
	}

	// Store the active process globally
	activeLTCProcess = cmd

	log.Printf("Started LTC playback using %s", config.LTC.FilePath)
	return cmd, nil
}

// stopLTC stops the LTC timecode playback if it's running
func stopLTC() error {
	if activeLTCProcess != nil && activeLTCProcess.Process != nil {
		log.Printf("Stopping LTC playback")
		err := activeLTCProcess.Process.Kill()
		if err != nil {
			log.Printf("Error stopping LTC playback: %v", err)
			return err
		}
		activeLTCProcess = nil
	}
	return nil
}

// endSessionHandler handles the request to end a recording session
func endSessionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	log.Printf("Ending recording session")

	// Stop all camera recordings
	results := make(map[string]bool)
	var wg sync.WaitGroup

	for _, camera := range config.Cameras {
		wg.Add(1)
		go func(cam Camera) {
			defer wg.Done()

			// Check if camera is reachable and recording
			recording, err := getCameraRecordingStatus(cam)
			if err != nil {
				// Camera not reachable
				results[cam.Name] = false
				return
			}

			if recording {
				// Stop recording
				err := stopCameraRecording(cam)
				results[cam.Name] = err == nil
				if err == nil {
					log.Printf("Successfully stopped recording on camera %s", cam.Name)
				} else {
					log.Printf("Failed to stop recording on camera %s: %v", cam.Name, err)
				}
			} else {
				// Not recording
				results[cam.Name] = true
			}
		}(camera)
	}

	// Wait for all camera operations to complete
	wg.Wait()

	// Stop LTC playback
	err := stopLTC()
	if err != nil {
		log.Printf("Error stopping LTC playback: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Session ended",
		"results": results,
	})
}
