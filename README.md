# Linksy PhoneNet 📱⚡

> **Effortless reverse tethering for Linux.**  
> Share your laptop's Wi-Fi internet connection to your Android phone wirelessly or over a USB cable.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux-blue.svg)](https://kernel.org)
[![NPM Version](https://img.shields.io/npm/v/linksy-phonenet.svg)](https://www.npmjs.com/package/linksy-phonenet)

---

## The Problem & The Solution

Most laptop Wi-Fi cards cannot run in standard hotspot mode while connected to a Wi-Fi network. In practice, activating an `nmcli` or GUI hotspot drops the laptop's existing wireless connection.

**Linksy PhoneNet** solves this by providing three simple, automated reverse tethering methods:
1. **Wireless Concurrent Wi-Fi Hotspot (`linksy on --wifi`)**: On dual-interface-capable Wi-Fi cards, Linksy automatically clones your upstream Wi-Fi frequency and channel into an independent virtual Access Point (`ap0`) with zero connection drops, automatic DHCP, and real-time device management.
2. **Wireless Bluetooth Reverse Tethering (`linksy on --bluetooth`)**: Broadcasts a Bluetooth PAN Network Access Point (NAP) bridge that provides wireless reverse tethering without radio conflicts.
3. **Wired Reverse USB Tethering (`linksy on`)**: Wraps `adb` and `gnirehtet` into a friendly, single-command experience that tunnels internet traffic through a USB cable without root.

---

## Installation

### One-line Setup

```bash
npx linksy-phonenet setup
```

### Or install globally via npm

```bash
npm install -g linksy-phonenet
linksy-phonenet setup
```

`linksy-phonenet setup` will:
1. Detect your Linux distribution.
2. Check for `adb` (Android Debug Bridge) and offer to install it automatically via your package manager (`dnf`, `apt`, `pacman`, or `zypper`) if missing.
3. Inspect your Wi-Fi interface capabilities (`iw list`) and let you know if your hardware supports concurrent hotspot mode.
4. Dynamically resolve and download the latest Gnirehtet release from GitHub directly into `~/.linksy/gnirehtet/`.
5. Set permissions and prepare everything for one-word commands.

---

## Daily Usage

You can connect your phone using **Wi-Fi Hotspot (Wireless)**, **Bluetooth (Wireless)**, or **USB Cable (Wired)**:

### Connection Modes

| Mode | Command | Best For | Description |
| :--- | :--- | :--- | :--- |
| **Wi-Fi Hotspot (Wireless)** | `linksy on --wifi`<br>`phonenet-on -w` | High-speed wireless | Broadcasts a concurrent Wi-Fi hotspot on the matching channel. Connect your phone via standard Wi-Fi (no cable or phone app needed). |
| **Bluetooth (Wireless)** | `linksy on --bluetooth`<br>`phonenet-on -b` | Universal wireless fallback | Reverse tethers over Bluetooth PAN. Toggle "Internet access" in phone Bluetooth settings. |
| **USB Cable (Wired)** | `linksy on`<br>`phonenet-on` | Fast wired tethering | Reverse USB tethering via ADB + Gnirehtet VPN tunnel. |

### Commands Table

### Direct Shortcuts
| Command | Description |
| :--- | :--- |
| `phonenet-on` | Start reverse tethering (pass `-w` for Wi-Fi, `-b` for Bluetooth) |
| `phonenet-off` | Stop all active Linksy connections (USB, Wi-Fi hotspot, or Bluetooth) |
| `phonenet-status` | Display status across USB, Wi-Fi hotspot, and Bluetooth PAN |
| `phonenet-doctor` | Run diagnostic checks for ADB, Wi-Fi AP capability, and Bluetooth |
| `phonenet-qr` | Display scannable Wi-Fi QR code in the terminal for instant mobile connection |

### Subcommands (`phonenet` or `linksy-phonenet`)
| Command | Description |
| :--- | :--- |
| `linksy on` | Start reverse tethering (options: `-w` / `--wifi`, `-b` / `--bluetooth`, `-n` / `--name <name>`, `-s` / `--ssid <name>`, `-p` / `--password <pass>`, `--no-password`) |
| `linksy off` | Stop all active tethering and hotspot services |
| `linksy status` | Display status of USB, Wi-Fi hotspot, connected devices, and Bluetooth sessions |
| `linksy qr` | Display a scannable Wi-Fi QR code in the terminal for instant phone connection (options: `-s`, `-p`, `--open`) |
| `linksy name [new-name]` | View or change your default Wi-Fi hotspot name (SSID) |
| `linksy devices` | View connected devices with hostname, IP, MAC, signal strength, and transfer stats |
| `linksy block <device>` | Disconnect and blacklist a device by hostname, IP, or MAC address |
| `linksy unblock <device>` | Remove a device from the blacklist |
| `linksy whitelist <device>` | Whitelist a device (pass `--remove` to unwhitelist) |
| `linksy doctor` | Comprehensive diagnostic checks with copy-pasteable fix commands |
| `linksy update` | Automatically check for and install the latest version from NPM |
| `linksy uninstall` | Clean up `~/.linksy/` binaries and temporary files |

### Example Workflows

#### 1. Wirelessly via Wi-Fi Hotspot (High Speed, No Cable)
```bash
# Start concurrent Wi-Fi hotspot on the matching channel
# Automatically uses your laptop model (e.g. "Linksy-ThinkPad-T490s") to prevent room collisions!
linksy on --wifi

# View your current hotspot name anytime:
linksy name

# Or set a permanent custom network name:
linksy name "Adams-Hotspot"

# Or specify a custom network name & password when starting:
linksy on --wifi --name "Adams-Hotspot" --password "<your-password>"
# Shorthand:
linksy on -w -n "Adams-Hotspot" -p "<your-password>"

# Or run with NO password (open network):
linksy on --wifi --no-password

# On your phone: Open Wi-Fi settings, connect to your network
# Or display a scannable QR code on your terminal screen:
linksy qr
# Enjoy high-speed wireless internet shared from your laptop!

# See who is connected to your hotspot (device name, IP, signal, data usage):
linksy devices

# Check connection status & password anytime:
linksy status

# Block an unwanted device (by name, IP, or MAC):
linksy block 192.168.42.29
# or by MAC:
linksy block aa:bb:cc:dd:ee:ff

# Unblock a device:
linksy unblock aa:bb:cc:dd:ee:ff

# Disconnect when finished:
linksy off
```

#### 2. Wirelessly via Bluetooth (No Cable)
```bash
# Start Bluetooth reverse tethering
linksy on --bluetooth

# On your phone: Settings → Bluetooth → tap laptop → toggle ON "Internet access"
# Disconnect when finished
linksy off
```

#### 3. Over USB Cable (Wired)
```bash
# 1. Plug in your Android phone via USB
# 2. Turn on tethering
phonenet-on

# 3. Accept the VPN prompt on screen
# Disconnect when finished
phonenet-off
```

---

## Supported Distributions (v1)

Linksy v1 supports **Linux** with automatic package manager detection for:
- **Fedora / RHEL / CentOS Stream** (`dnf`)
- **Ubuntu / Debian / Linux Mint** (`apt`)
- **Arch Linux / Manjaro** (`pacman`)
- **openSUSE** (`zypper`)

*Manual fallback instructions are provided if your package manager is unrecognized.*

---

## Diagnostics (`linksy doctor`)

If your phone is not connecting, run:

```bash
linksy doctor
```

Linksy doctor checks:
1. Is `adb` installed and on your system `PATH`?
2. Is the `gnirehtet` binary present and executable in `~/.linksy/`?
3. Is a physical Android phone detected via USB?
4. Is USB debugging authorized (i.e. RSA key accepted on the phone screen)?
5. Is Wi-Fi AP+STA concurrent mode supported by your Wi-Fi card?
6. Is Bluetooth PAN available for wireless fallback?
7. Is your Linksy CLI up-to-date with the latest release on NPM?

For any failed step, `doctor` provides an immediate, copy-pasteable fix.

---

## Updating Linksy (`linksy update`)

Linksy automatically checks for updates in the background without adding any latency to your commands. If a new release is available, a non-intrusive alert box is shown at the end of command runs.

To update Linksy to the latest version at any time:

```bash
linksy update
```

Linksy will check NPM, download and upgrade the global package, and verify the installation automatically.

---

## Hardware Testing Checklist

For verifying Linksy on real hardware:

- [ ] **Prerequisites**: USB cable with data support (not charge-only), Android phone (Android 5.0+).
- [ ] **USB Debugging**: On your phone, go to **Settings** → **About phone** → tap **Build number** 7 times. Go to **Developer options** → toggle **USB debugging** ON.
- [ ] **Plug In**: Connect phone to laptop via USB.
- [ ] **Verify Device**: Run `adb devices`. You should see `<serial>  device` or `<serial>  unauthorized`.
- [ ] **Run Doctor**: Run `linksy doctor` to confirm all checks pass.
- [ ] **Start Tethering**: Run `linksy on`.
- [ ] **Authorize on Phone**: Tap **OK** on the "Connection request" (Gnirehtet VPN prompt) on your phone.
- [ ] **Test Connectivity**: Turn off Cellular Data and Wi-Fi on your phone. Open a browser on the phone and verify internet access works!
- [ ] **Stop**: Run `linksy off` and confirm the VPN closes.

---

## Roadmap

### Completed Features ✔
- [x] Concurrent Wi-Fi AP+STA wireless reverse tethering (see [Wireless Reverse Tethering Research](docs/wireless-reverse-tethering-research.md))
- [x] Bluetooth PAN wireless reverse tethering (`linksy on --bluetooth`)
- [x] Real-time connected device monitoring (`linksy devices`)
- [x] Hotspot access control (blacklist / whitelist with `linksy block` & `linksy unblock`)
- [x] Pre-emptive NetworkManager radio collision prevention (zero upstream Wi-Fi drops)
- [x] Smart DMI hardware-based hotspot SSID naming & custom names (`linksy name`)
- [x] Automatic non-blocking update notifications & one-word update command (`linksy update`)

### Planned for Future Versions
- [ ] macOS & Windows platform support
- [ ] System tray / desktop GUI app
- [ ] iOS reverse tethering support

---

## Credits & Acknowledgements

Linksy is a UX wrapper and workflow orchestrator. It builds upon these open-source tools:
- **[Gnirehtet](https://github.com/Genymobile/gnirehtet)** by Genymobile — the reverse tethering engine and Android VPN client.
- **[Android Debug Bridge (adb)](https://developer.android.com/tools/adb)** by the Android Open Source Project (AOSP).

---

## License

[MIT License](LICENSE) © 2026 Linksy Contributors
