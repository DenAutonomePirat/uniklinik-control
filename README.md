# Uniklinik-control

A Go-based web application for controlling two Blackmagic cameras simultaneously.

## Features

- Control two Blackmagic cameras from a single interface
- Start and stop recording on both cameras syncronized via ltc playout from the audio jack
- Monitor USB device status
- Configure camera hostnames and connection settings

## Requirements

- Go 1.16 or higher
- Blackmagic cameras with network control enabled
- Web browser

## Installation

1. Clone this repository
2. Configure your camera settings in `config.yaml`
3. Run the application:

```bash
go run main.go
```

4. Open your web browser and navigate to `http://localhost:8080`

## Configuration

Edit the `config.yaml` file to configure your camera settings:

```yaml
cameras:
  - name: "Camera 1"
    hostname: "studio-camera-6k-pro-1.local"
    username: ""
    password: ""
  - name: "Camera 2"
    hostname: "studio-camera-6k-pro-2.local"
    username: ""
    password: ""
server:
  port: 8080
  host: "localhost"
```

## Usage

- Use the web interface to control both cameras
- Start/stop recording with a single click
- Monitor USB status for both cameras
- Update camera settings as needed

## Raspberry Pi Setup

### 1. Flash SD Card
- Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
- Use the **32-bit Lite** image (no desktop included)
- Enable SSH in Advanced Options

---

### 2. Update System
```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```
- Updates all packages to latest versions
- Reboots to apply kernel updates

---

### 3. Install Desktop Environment & Browser
```bash
sudo apt install --no-install-recommends \
  xserver-xorg \
  x11-xserver-utils \
  xinit \
  openbox \
  chromium \
  lightdm -y
```
- **openbox**: Lightweight window manager
- **chromium**: Web browser for kiosk mode
- **lightdm**: Display manager (login screen)

---

### 4. Configure Auto-Login (LightDM)
```bash
sudo nano /etc/lightdm/lightdm.conf
```

Add/edit:
```ini
[Seat:*]
autologin-user=uniklinik
autologin-session=openbox
```
- Automatically logs in as `uniklinik` user
- Starts Openbox session

---

### 5. Configure Openbox Auto-Start
```bash
mkdir -p ~/.config/openbox
nano ~/.config/openbox/autostart
```

Add content (example):
```bash
# Start Chromium in kiosk mode
chromium --kiosk --incognito http://localhost:8080
```
- Runs when Openbox starts
- Typically used to launch browser in fullscreen kiosk mode

---

### 6. Enable GUI Boot
```bash
sudo systemctl enable lightdm
sudo systemctl set-default graphical.target
```
- Enables LightDM display manager
- Boots to GUI instead of CLI

---

### 7. Install Application
```bash
sudo mkdir -p /opt/uniklinik
sudo cp uniklinik-control /opt/uniklinik/
sudo chmod +x /opt/uniklinik/uniklinik-control
sudo chown -R uniklinik:uniklinik /opt/uniklinik
```
- Copies application to system directory
- Sets executable permission
- Changes ownership to uniklinik user

---

### 8. Create Systemd Service
```bash
sudo nano /etc/systemd/system/uniklinik-control.service
```

```ini
[Unit]
Description=Uniklinik Control Local Web Service
After=network.target
Wants=network.target

[Service]
Type=simple
User=uniklinik
Group=uniklinik
WorkingDirectory=/opt/uniklinik
ExecStart=/opt/uniklinik/uniklinik-control
Restart=always
RestartSec=2

# Logging
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- **Type=simple**: Process doesn't fork
- **Restart=always**: Restarts on crash
- **RestartSec=2**: Waits 2 seconds before restart
- Logs go to journal (`journalctl -u uniklinik-control`)

---

### 9. Enable and Start Service
```bash
sudo systemctl daemon-reload
sudo systemctl enable uniklinik-control
sudo systemctl start uniklinik-control
```

---

### 10. Check Service Status
```bash
systemctl status uniklinik-control
```

---

### 11. Enable Read-Only Filesystem (OverlayFS)
```bash
sudo raspi-config
```
Navigate:
- **Performance Options** → **Overlay Filesystem** → **Enable overlay filesystem: YES**
- **Make root filesystem read-only: YES**
- **Make boot filesystem read-only: NO**

Then reboot when prompted:
```bash
sudo reboot
```

This protects the SD card from write wear and enables safe power-off.

---

## Hardening

### Disable WiFi and Bluetooth
Edit `/boot/firmware/config.txt`:
```ini
# Disable WiFi
dtoverlay=disable-wifi

# Disable Bluetooth
dtoverlay=disable-bt
```

### Disable Unnecessary Services
```bash
sudo systemctl disable bluetooth
sudo systemctl disable wifi-scan
sudo systemctl mask avahi-daemon
```

### Change Default Password
```bash
passwd uniklinik
```

### Secure SSH (if enabled)
1. Use SSH keys instead of password
2. Edit `/etc/ssh/sshd_config`:
```bash
PasswordAuthentication no
PermitRootLogin no
```
3. Restart: `sudo systemctl restart ssh`

### Disable Serial Console
```bash
sudo systemctl disable serial-getty@ttyS0
```

### Useful Commands
```bash
# View logs
journalctl -u uniklinik-control -f

# Restart service
sudo systemctl restart uniklinik-control

# Stop service
sudo systemctl stop uniklinik-control
```

## License

This project is licensed under the [GNU GPL v3 License](https://www.gnu.org/licenses/gpl-3.0.html).

## Acknowledgments

- Based on the [Blackmagic Camera Control REST API](https://documents.blackmagicdesign.com/DeveloperManuals/RESTAPIforBlackmagicCameras.pdf)
- Inspired by the [BM-API-Tutorial](https://github.com/DylanSpeiser/BM-API-Tutorial)