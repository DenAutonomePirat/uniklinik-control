# Dual Camera Controller

A Go-based web application for controlling two Blackmagic cameras simultaneously.

## Features

- Control two Blackmagic cameras from a single interface
- Start and stop recording on both cameras
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

## License

This project is licensed under the GNU GPL v3 License - see the LICENSE file for details.

## Acknowledgments

- Based on the [Blackmagic Camera Control REST API](https://documents.blackmagicdesign.com/DeveloperManuals/RESTAPIforBlackmagicCameras.pdf)
- Inspired by the [BM-API-Tutorial](https://github.com/DylanSpeiser/BM-API-Tutorial)