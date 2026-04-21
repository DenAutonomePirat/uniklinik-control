sudo apt update && sudo apt full-upgrade -y
sudo reboot



sudo apt install --no-install-recommends \
  xserver-xorg \
  x11-xserver-utils \
  xinit \
  openbox \
  chromium \
  lightdm -y


sudo nano /etc/lightdm/lightdm.conf

[Seat:*]
autologin-user=uniklinik
autologin-session=openbox

mkdir -p ~/.config/openbox
nano ~/.config/openbox/autostart


