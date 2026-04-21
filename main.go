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
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// Config represents the application configuration
type Config struct {
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
}

func main() {
	// Set up routes
	http.HandleFunc("/", indexHandler)
	http.HandleFunc("/api/cameras", getCamerasHandler)
	http.HandleFunc("/api/camera/record", toggleRecordHandler)
	http.HandleFunc("/api/camera/usb-status", getUSBStatusHandler)
	http.HandleFunc("/api/session/start", startSessionHandler)
	http.HandleFunc("/api/session/end", endSessionHandler)

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
		if remainingHours < 1.0 {
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

		// Start recording on all valid cameras
		var wg sync.WaitGroup
		for _, camera := range validCameras {
			wg.Add(1)
			go func(cam Camera) {
				defer wg.Done()
				success, err := setCameraRecording(cam, true)
				if err != nil || !success {
					log.Printf("Failed to start recording on camera %s: %v", cam.Name, err)
				} else {
					log.Printf("Successfully started recording on camera %s", cam.Name)
				}
			}(camera)
		}

		// Wait for all camera operations to complete
		wg.Wait()
		log.Printf("All camera recording operations completed")

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
				success, err := setCameraRecording(cam, false)
				results[cam.Name] = err == nil && success
				if err == nil && success {
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
