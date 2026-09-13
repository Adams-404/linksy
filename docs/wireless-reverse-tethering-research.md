# Wireless Reverse Tethering Research & Architecture

> **Document Version**: 1.2.0  
> **Date**: September 2026  
> **Target Project**: Linksy PhoneNet  
> **Author**: Adams-404  

---

## 1. Executive Summary & Problem Definition

### 1.1 The "Single-Device Paid Wi-Fi" Dilemma
Users frequently find themselves in environments where Wi-Fi access is restricted to a single authenticated device:
- **Hotels & Airports**: Captive portals charging per device or issuing single-use vouchers.
- **University & Enterprise Campuses**: Strict MAC-address registration or 802.1X certificates restricted to a primary laptop.
- **Mobile Hotspots / Metered Wi-Fi**: Networks with per-device billing.

In these environments, a user logs into the Wi-Fi on their Linux laptop. They want their phone (and potentially other devices) to share that connection **wirelessly**, without purchasing an additional access pass.

### 1.2 The Traditional Linux Failure
When users attempt to share their connection using standard Linux tools (e.g. GNOME Settings "Turn On Wi-Fi Hotspot..." or `nmcli device wifi hotspot`), the laptop immediately **disconnects from the Wi-Fi network**.

Historically, this led users to believe that single-card Linux laptops are physically incapable of concurrent station + hotspot mode, giving birth to wired solutions like Linksy's reverse USB tethering via `adb` and `gnirehtet`.

This document records the exact root cause of that failure, the real hardware capabilities of modern Linux laptops, and the viable architectures for achieving seamless wireless reverse tethering.

---

## 2. Hardware & Kernel Realities

### 2.1 Hardware Inspection
On an Intel-based laptop (such as the ThinkPad T490 running an Intel Cannon Point-LP CNVi Wireless-AC 9560 / `iwlwifi` driver):

Running `iw list` exposes the kernel driver's supported interface combinations:

```text
valid interface combinations:
    * #{ managed } <= 1, #{ P2P-client, P2P-GO } <= 1, #{ P2P-device } <= 1,
      total <= 3, #channels <= 2
    * #{ managed } <= 1, #{ AP, P2P-client, P2P-GO } <= 1, #{ P2P-device } <= 1,
      total <= 3, #channels <= 1
```

### 2.2 Decoding the Interface Combination
Notice the second rule:
- `#{ managed } <= 1`: One station/client connection (connected to the upstream router).
- `#{ AP, P2P-client, P2P-GO } <= 1`: One Access Point (hotspot) or Wi-Fi Direct interface.
- `total <= 3`: Up to 3 interfaces concurrently.
- **`#channels <= 1`**: **The crucial constraint.**

The hardware driver **DOES** support simultaneous Managed (STA) + AP mode. However, both interfaces must operate on the **exact same radio channel and frequency**.

### 2.3 Why NetworkManager / GNOME Fails
1. **Full Device Reassignment**: NetworkManager treats `wlp0s20f3` as a monolithic device. Activating a hotspot profile switches the entire physical device role from STA to AP rather than creating a virtual interface.
2. **Channel Mismatch**: Default NetworkManager hotspot profiles attempt to bring up the AP on a hardcoded or default channel (such as 2.4 GHz channel 1, 6, or 11). If the laptop is connected to a 5 GHz network on Channel 157 (5785 MHz), the kernel driver rejects the request with `EBUSY` or `EINVAL` because `#channels <= 1` is violated.
3. **OS Architecture Contrast**: Windows implements a virtual Wi-Fi miniport multiplexer in its NDIS stack that transparently synchronizes SoftAP channels with the active STA channel. Linux exposes raw hardware capabilities via `mac80211` and `cfg80211`, leaving channel synchronization to user-space tooling.

---

## 3. Architecture 1: Concurrent Wi-Fi Hotspot (AP + STA)

### 3.1 Concept
By dynamically inspecting the active channel of the laptop's Wi-Fi connection, Linux can spawn a secondary virtual network interface (`ap0`) and pin a dedicated `hostapd` instance to that exact frequency, preserving the station connection while broadcasting an AP.

```
                  ┌─────────────────────────────────────────┐
                  │              Linux Laptop               │
                  │                                         │
Upstream Router ◄─┼──[wlp0s20f3] (Managed, Ch 157)          │
 (Hotel / Cafe)   │       ▲                                 │
                  │       │ IP Forwarding & NAT (nftables)  │
                  │       ▼                                 │
 Android Phone  ──┼──[ap0] (Virtual AP, Ch 157)             │
  (or any device) │    └─ hostapd + dnsmasq (192.168.42.1)  │
                  └─────────────────────────────────────────┘
```

### 3.2 Technical Implementation Steps
1. **Query Active Link Parameters**:
   ```bash
   iw dev wlp0s20f3 link
   # Returns: freq: 5785 (Channel 157)
   ```
2. **Create Virtual AP Interface**:
   ```bash
   sudo iw dev wlp0s20f3 interface add ap0 type __ap
   sudo ip link set ap0 address <randomized-or-derived-mac>
   sudo ip link set ap0 up
   ```
3. **Configure and Spawn `hostapd`**:
   Write a temporary `hostapd.conf` pinned to the detected channel:
   ```ini
   interface=ap0
   driver=nl80211
   ssid=LinksyHotspot
   hw_mode=a          # 'g' for 2.4GHz, 'a' for 5GHz
   channel=157        # Must match active upstream channel exactly
   wpa=2
   wpa_passphrase=YourSecurePassword
   wpa_key_mgmt=WPA-PSK
   rsn_pairwise=CCMP
   ```
4. **Assign Subnet and Start DHCP/DNS**:
   ```bash
   sudo ip addr add 192.168.42.1/24 dev ap0
   sudo dnsmasq --interface=ap0 --bind-interfaces \
     --dhcp-range=192.168.42.10,192.168.42.100,12h \
     --dhcp-option=3,192.168.42.1 \
     --dhcp-option=6,1.1.1.1,8.8.8.8
   ```
5. **Enable IP Forwarding & NAT**:
   ```bash
   sudo sysctl -w net.ipv4.ip_forward=1
   sudo iptables -t nat -A POSTROUTING -o wlp0s20f3 -j MASQUERADE
   sudo iptables -A FORWARD -i ap0 -o wlp0s20f3 -j ACCEPT
   sudo iptables -A FORWARD -i wlp0s20f3 -o ap0 -m state --state RELATED,ESTABLISHED -j ACCEPT
   ```

### 3.3 Pros & Cons
- **Pros**:
  - High performance: Full Wi-Fi bandwidth (100–400+ Mbps depending on 802.11ac/ax link).
  - Universal compatibility: Connects any phone (Android, iPhone, tablet) out of the box with zero apps required.
  - Standard Wi-Fi user experience.
- **Cons**:
  - Requires root privileges (`sudo` or a small polkit helper) to manage network interfaces, `hostapd`, and firewall rules.
  - Channel hopping sensitivity: If the upstream Wi-Fi AP forces the laptop to roam or switch channels, `hostapd` must be refreshed to match the new channel.

### 3.4 Automated Dependency Resolution & Daemon Orchestration
- **Package Auto-Installation**: Linksy automatically detects missing packages (`hostapd`, `dnsmasq`) and provisions them using the host package manager (`dnf`, `apt`, `pacman`, `zypper` via `sudo`).
- **NetworkManager Isolation**: When a virtual interface (`ap0`) is added, NetworkManager by default attempts to claim it and marks it `unavailable`. Linksy executes `nmcli device set ap0 managed no` to prevent interference.
- **Dynamic DHCP Binding**: Starting `dnsmasq` with `--bind-dynamic` allows the DHCP server to bind to the virtual interface after `hostapd` completes radio channel initialization, avoiding race conditions or `unknown interface` errors.
- **Daemon Lifecycle**: `hostapd` is launched in daemon mode (`-B -P <pidfile>`), validating the configuration and radio binding synchronously before handing off to background operation.

---

## 4. Architecture 2: Bluetooth Reverse Tethering (Bluetooth PAN / NAP)

### 4.1 Concept
Bluetooth operates on a dedicated 2.4 GHz frequency-hopping radio completely independent of the Wi-Fi card. Linux can configure BlueZ as a **Network Access Point (NAP)**. Android has built-in native support to act as a **Personal Area Network User (PANU)**.

```
                  ┌─────────────────────────────────────────┐
                  │              Linux Laptop               │
                  │                                         │
Upstream Router ◄─┼──[wlp0s20f3] (Wi-Fi)                    │
                  │       ▲                                 │
                  │       │ IP Forwarding & NAT (nftables)  │
                  │       ▼                                 │
                  │   [pan0 Bridge] (10.42.0.1/24)          │
                  │       ▲                                 │
                  │       │ BlueZ NetworkServer (NAP)       │
                  │       ▼                                 │
 Android Phone  ──┼──[bnep0] (Bluetooth L2CAP PAN Profile)  │
                  └─────────────────────────────────────────┘
```

### 4.2 Technical Implementation Steps
1. **Initialize Bridge Interface**:
   ```bash
   sudo ip link add name pan0 type bridge
   sudo ip addr add 10.42.0.1/24 dev pan0
   sudo ip link set pan0 up
   ```
2. **Register BlueZ NAP Service**:
   Via BlueZ D-Bus API `org.bluez.NetworkServer1`:
   ```bash
   busctl call org.bluez /org/bluez/hci0 org.bluez.NetworkServer1 Register ss "nap" "pan0"
   ```
3. **DHCP & NAT Setup**:
   NetworkManager can manage `pan0` with `ipv4.method shared`, or `dnsmasq` can serve `10.42.0.0/24` with `sysctl net.ipv4.ip_forward=1`.
4. **Android Client Connection**:
   - On the Android phone: Open **Settings** → **Bluetooth**.
   - Pair with the laptop.
   - Tap the settings gear next to the laptop's name.
   - Toggle **"Internet access"** ON.
   - BlueZ creates a `bnepX` interface and attaches it to `pan0`. Android automatically configures its default gateway to `10.42.0.1`.

### 4.3 Pros & Cons
- **Pros**:
  - **Zero radio conflict**: Completely independent of the Wi-Fi card's channel, band, or power state.
  - Native to Android: No app or APK installation required on the phone.
  - Works even if the laptop is on 5 GHz, 2.4 GHz, or Ethernet.
- **Cons**:
  - Throughput limit: Bluetooth PAN (BR/EDR) caps out at roughly ~1.5–3 Mbps. Suitable for messaging, email, web reading, and audio; slow for high-definition streaming.
  - Bluetooth controller must be unblocked (`rfkill unblock bluetooth`) and powered on.

---

## 5. Architecture 3: Wireless ADB + Gnirehtet (Direct Linksy Port)

### 5.1 Concept
Android 11+ supports **Wireless Debugging** (ADB over TLS via pairing codes on port ranges 30000–50000).

```bash
adb pair <phone-ip>:<pairing-port> <pairing-code>
adb connect <phone-ip>:<connect-port>
gnirehtet run <phone-ip>:<connect-port>
```

### 5.2 The Bootstrap Problem
Gnirehtet requires an existing IP connection between the phone and laptop before ADB can attach.
- If the phone is **not** connected to the paid Wi-Fi, the laptop cannot route packets to the phone's IP.
- Therefore, Wireless ADB cannot bootstrap from zero without **either** Architecture 1 (Wi-Fi AP) or Architecture 2 (Bluetooth PAN) running first.
- **Conclusion**: Once Architecture 1 or 2 is established, the phone already has direct IP routing and NAT, rendering Gnirehtet redundant for wireless scenarios. Gnirehtet remains the optimal solution specifically for USB-wired mode.

---

## 6. Architecture Comparison Matrix

| Attribute | Solution 1: Wi-Fi AP+STA | Solution 2: Bluetooth PAN | Current Linksy: USB Wired |
| :--- | :--- | :--- | :--- |
| **Physical Medium** | Wireless (802.11 Wi-Fi) | Wireless (Bluetooth) | Wired (USB Cable) |
| **Bandwidth** | 100 – 400+ Mbps | 1.5 – 3.0 Mbps | 300+ Mbps (USB 2/3) |
| **Channel Dependency** | Must match Wi-Fi channel | None (Independent) | None (Independent) |
| **Phone Setup** | Normal Wi-Fi login | Toggle "Internet access" in BT | USB Debugging + VPN prompt |
| **Phone App Needed** | None | None | Yes (Gnirehtet APK) |
| **Root Needed on PC** | Yes (`hostapd` / iptables) | Yes (Bridge / iptables) | No (`adb` + userland tunnel) |
| **Supported Devices** | Any (Android, iOS, PC) | Android, PC | Android only |

---

## 7. Implementation & Architecture Evolution

Linksy evolved from a USB-only tool into a full multi-transport connectivity CLI:

```text
linksy on              # Default: Fast, zero-root USB reverse tethering
linksy on --wifi       # High-speed wireless hotspot (AP+STA on matching channel)
linksy on --bluetooth  # Wireless fallback via Bluetooth PAN NAP
linksy devices         # Real-time list of connected devices with IP, MAC, and signal
linksy block <device>  # Instant MAC/IP/hostname device blocking
linksy unblock <dev>   # Instant ACL removal
linksy doctor          # Comprehensive diagnostic for USB, Wi-Fi AP capability, and Bluetooth
```

### Production Architecture (Released in v1.1.0):
1. **Wi-Fi AP (`src/lib/wifiHotspot.js`)**: Inspects active Wi-Fi channel on `wlp0s20f3`, provisions virtual `ap0` with pre-emptive NetworkManager exclusion, starts `hostapd` with control socket group permissions (`wheel`), and provisions `dnsmasq` DHCP with lease logging.
2. **Bluetooth PAN (`src/lib/bluetoothPan.js`)**: BlueZ NAP bridge registration and dynamic D-Bus agent pairing with iptables routing.
3. **Device Management & Telemetry (`src/lib/deviceManager.js`)**: Aggregates station dump (`nl80211`), DHCP lease mapping, and ARP table for live inspection and ACL modification via `hostapd_cli` without root.

---

## 8. Firewall & Ingress Routing (The Fedora / firewalld DHCP Drop)

### 8.1 Symptom
When a client (e.g. Android phone) attempts to connect to `Linksy-Hotspot`, the system logs show:
```text
hostapd: ap0: STA xx:xx:xx:xx:xx:xx IEEE 802.11: authenticated
hostapd: ap0: STA xx:xx:xx:xx:xx:xx IEEE 802.11: associated
hostapd: ap0: STA xx:xx:xx:xx:xx:xx WPA: pairwise key handshake completed (RSN)
```
The Layer 2 Wi-Fi connection and WPA2 handshake succeed completely. However, on the client screen, the phone remains stuck on **"Obtaining IP address..."** and eventually times out.

### 8.2 Root Cause
Modern Linux distributions like Fedora and RHEL enforce host firewalls using `firewalld` (or `ufw` on Ubuntu).
1. When a new virtual interface (`ap0` or `pan0`) is created, it has no zone assignment and defaults to the system's default zone (e.g. `FedoraWorkstation`).
2. The default zone permits only outbound client services (e.g. SSH, DHCPv6 client, Samba). Inbound UDP port 67 (DHCP server requests from clients) and UDP port 53 (DNS) are rejected with `icmp-host-prohibited`.
3. Furthermore, standard `iptables -A FORWARD` appends rules *after* the firewall's rejection chains.

### 8.3 The Resolution
Linksy handles this automatically by:
1. Assigning virtual interfaces (`ap0`, `pan0`) to `firewalld`'s `trusted` zone in memory:
   ```bash
   firewall-cmd --zone=trusted --add-interface=ap0
   ```
2. Inserting explicit top-priority rules in the `iptables` `INPUT` and `FORWARD` chains:
   ```bash
   iptables -I INPUT -i ap0 -p udp --dport 67:68 --sport 67:68 -j ACCEPT
   iptables -I INPUT -i ap0 -p udp --dport 53 -j ACCEPT
   iptables -I INPUT -i ap0 -p tcp --dport 53 -j ACCEPT
   iptables -I FORWARD -i ap0 -o <upstream-iface> -j ACCEPT
   iptables -I FORWARD -i <upstream-iface> -o ap0 -m state --state RELATED,ESTABLISHED -j ACCEPT
   ```
3. Enabling `--log-dhcp` on `dnsmasq` to provide immediate logging of DHCP transactions.
4. Cleanly removing interfaces from `trusted` and pruning rules upon `linksy off`.

---

## 9. Device Visibility & Access Control Architecture

### 9.1 Real-Time Connected Device Discovery
To provide immediate visibility into who is connected to `Linksy-Hotspot`, Linksy combines three system sources:
1. **Layer 2 Metrics (`iw dev ap0 station dump`)**:
   - Queries the Linux wireless subsystem (`nl80211`) for active associated MAC addresses.
   - Extracts real-time signal strength (dBm), transmission bitrates (MCS), byte counters (RX/TX), and connection duration.
2. **Layer 3 DHCP Leases (`dnsmasq.leases`)**:
   - `dnsmasq` persists client hostname and IP bindings (e.g. `de:99:a9:f4:57:d6 192.168.42.29 S26-Ultra`).
   - Cross-referenced with active station MACs to map human-readable device names and leased IPs.
3. **ARP Table Fallback (`/proc/net/arp`)**:
   - Acts as a fallback for devices with static IPs or before lease persistence completes.

Exposed via `linksy devices` and `linksy status`.

### 9.2 Device Access Control (Blacklisting & Whitelisting)
Linksy implements a two-tier defense mechanism:
- **Layer 2 (`hostapd` ACL & Deauthentication)**:
  - `hostapd` is started with `ctrl_interface=/run/hostapd`, `ctrl_interface_group=wheel` (or system admin group), and `deny_mac_file=~/.linksy/wifi/hostapd.deny` (or `accept_mac_file`).
  - Configuring `ctrl_interface_group` enables `hostapd_cli` commands to run directly under the user's account without requiring root, `sudo`, or biometric prompts.
  - When a user runs `linksy block <device>`, Linksy resolves the hostname or IP to a MAC address, appends it to `hostapd.deny`, dynamically updates hostapd's active memory via `hostapd_cli DENY_ACL ADD_MAC <mac>`, and issues live `deauthenticate` and `disassociate` commands.
- **Layer 3 (Kernel Firewall Drop)**:
  - Inserts non-blocking `iptables -I INPUT/FORWARD -i ap0 -m mac --mac-source <MAC> -j DROP` rules to prevent any queued or spoofed packets from reaching the laptop or upstream gateway.

---

## 10. Startup NetworkManager Race Condition & Resolution

### 10.1 Symptom
When starting the Wi-Fi hotspot (`linksy on --wifi`), the laptop's upstream Wi-Fi connection temporarily disconnected for a few moments before reconnecting.

### 10.2 Root Cause Analysis
1. When `iw dev <iface> interface add ap0 type __ap` created the virtual interface, NetworkManager's `udev` device monitor detected `ap0` before `nmcli device set ap0 managed no` could execute.
2. NetworkManager signaled `wpa_supplicant` to manage `ap0`.
3. Because both `ap0` and the upstream interface (e.g. `wlp0s20f3`) share the single physical radio (`wiphy0`), `wpa_supplicant` attempted to reinitialize driver state on `wiphy0` (`Could not set interface ap0 flags (UP): Device or resource busy`).
4. This driver collision disrupted the active 4-way group key handshake with the upstream Wi-Fi access point, causing `wlp0s20f3` to log `CTRL-EVENT-DISCONNECTED reason=16`.
5. Once NetworkManager completed its reconnect sequence, `ap0` was marked unmanaged and the connection remained stable.

### 10.3 Pre-emptive Resolution
Linksy prevents this race condition entirely by pre-configuring NetworkManager *before* the virtual interface is created:
1. Linksy writes an unmanaged rule into `/run/NetworkManager/conf.d/99-linksy.conf`:
   ```ini
   [keyfile]
   unmanaged-devices=interface-name:ap0;interface-name:pan0
   ```
2. Linksy triggers `nmcli general reload conf`.
3. NetworkManager's udev handler immediately ignores `ap0` and `pan0` upon creation. `wpa_supplicant` is never asked to touch the virtual interface, eliminating the radio reinitialization and preserving the upstream Wi-Fi connection with zero drops.
4. On `linksy off`, the transient configuration in `/run` is deleted and reloaded.

---

## 11. Hardware Compatibility: Intel 8265, PCIe Adapters & The Invisible Hotspot Fix

### 11.1 Symptom
On certain laptops (such as the Dell Latitude 7490 equipped with an Intel Dual Band Wireless-AC 8265 or PCIe wireless cards), `linksy on --wifi` reported success and `hostapd` started without error. However, client devices (smartphones, other laptops) could not see or discover the broadcasted SSID.

### 11.2 Root Cause Analysis
Deep analysis of kernel wireless subsystem (`mac80211`/`cfg80211`) and card firmware revealed three interacting issues:
1. **Virtual BSSID MAC Duplication**:
   Unlike integrated CNVi cards (e.g. Intel 9560 on ThinkPad T490) where the kernel generates a distinct virtual MAC, PCIe modules like Intel 8265 assign the exact same hardware MAC address to `ap0` as the active station `wlp0s20f3`. When the AP BSSID matches the station client MAC, the card firmware/driver filters or drops outgoing beacon frames.
2. **Interface Link State Pre-Activation**:
   Bringing the `ap0` interface `UP` via `ip link set dev ap0 up` *before* `hostapd` initialization caused `nl80211` driver radio configuration to fail or enter a non-beaconing state on certain cards. `hostapd` requires the interface link state to be down prior to radio binding.
3. **Self-Managed Regulatory Firmware (LAR) & Country Code**:
   Intel wireless cards implement Location-Aware Regulatory (LAR) tables directly in card firmware (`phy#0 (self-managed) country 00: DFS-UNSET`). Injecting `country_code` into `hostapd.conf` forces `hostapd` to send a country update request to the kernel driver, trapping the daemon in `COUNTRY_UPDATE` state where beacon frames are inhibited.

### 11.3 The Resolution
Linksy resolves these hardware variations automatically:
1. **Dynamic MAC Collision Detection & LAA Derivation**:
   When creating `ap0`, Linksy compares `ap0`'s MAC with the physical adapter's MAC. If identical, Linksy dynamically calculates and assigns a distinct Locally Administered Address (LAA) with the unicast bit preserved (`ip link set dev ap0 address <new_mac>`).
2. **Clean Interface Lifecycle Sequencing**:
   `ap0` is kept strictly `DOWN` while `hostapd` binds the `nl80211` radio and configures beacons. Only after `hostapd` binds is the link brought `UP` and the private subnet IP assigned.
3. **Elimination of Unsolicited Country Updates**:
   In concurrent STA+AP mode, the radio already operates within the valid regulatory constraints of the upstream connected router. Omitting unsolicited `country_code` entries prevents self-managed adapters from entering `COUNTRY_UPDATE` stalls, allowing instant beaconing across all supported machines.

---

## 12. Regional Regulatory Domain Incompatibilities & Automatic 2.4 GHz Self-Healing (The Nigeria 5 GHz Channel 48 Case Study)

### 12.1 Symptom
On laptops connected to a 5 GHz Wi-Fi network, `linksy on --wifi` executes successfully and reports an active hotspot (`state=ENABLED`, `ap0: AP-ENABLED`). However:
1. Mobile devices (particularly smartphones with Nigerian SIM cards or regional carrier MCC 621) cannot see the broadcasted SSID in their Wi-Fi network picker.
2. Scanning the terminal Wi-Fi QR code (`linksy qr`) results in an immediate or delayed "Failed to connect" error on the client device.
3. Host system logs reveal that `hostapd` received zero probe requests, authentication frames, or association attempts from the phone.
4. The setup functioned seamlessly on 5 GHz previously when the upstream router operated on Channel 149 (5745 MHz), but broke without warning when the router roamed to Channel 48 (5240 MHz).

### 12.2 Root Cause Analysis
This failure is not a hardware fault or hostapd configuration bug, but a client-side regulatory enforcement lock:

1. **Carrier MCC & Mobile Regulatory Tables (`regdb`)**:
   Modern mobile operating systems (Android via `wificond` and iOS) determine their Wi-Fi regulatory domain dynamically from the cellular carrier's Mobile Country Code (MCC), e.g. MCC 621 for Nigeria (`NG`).
2. **The Nigerian Communications Commission (NCC) / ETSI Frequency Gap**:
   Inspecting the kernel regulatory database for Nigeria (`iw reg get`):
   ```text
   global
   country NG: DFS-ETSI
       (2402 - 2482 @ 40), (N/A, 20), (N/A)
       (5250 - 5330 @ 80), (N/A, 30), (0 ms), DFS
       (5735 - 5835 @ 80), (N/A, 30), (N/A)
   ```
   Notice the authorized allocations:
   - **2.4 GHz (Channels 1–13)**: Fully authorized (`2402 - 2482 MHz`).
   - **5.2 GHz DFS (Channels 52–64)**: Authorized with Dynamic Frequency Selection (`5250 - 5330 MHz`).
   - **5.8 GHz U-NII-3 / Band 4 (Channels 149–165)**: Fully authorized (`5735 - 5835 MHz`).
   - **U-NII-1 (5150–5250 MHz / Channels 36–48)** and **U-NII-2C (5470–5725 MHz / Channels 100–144)** are **completely absent** from the Nigerian regulatory database.
3. **Client-Side Baseband Radio Lock**:
   When an Android or iOS device operates with a Nigerian SIM, the baseband driver applies the `NG` regulatory profile and **completely disables scanning and transmitting on Channels 36–48**. Even when explicitly instructed to connect via a QR code or manual profile, the phone's Wi-Fi chip refuses to tune its receiver to 5240 MHz.
4. **Router Auto-Channel Hopping in Single-Radio Concurrent Mode**:
   Because concurrent STA+AP mode requires both station and AP interfaces to share a single physical channel (`#channels <= 1`), Linksy cloned the upstream router's active channel. When the router dynamically shifted from Channel 149 (allowed in Nigeria) to Channel 48 (restricted in Nigeria), Linksy followed suit, unintentionally moving the hotspot out of range of local mobile devices.

### 12.3 The Resolution & Architecture (Released in v1.5.0)
Linksy resolves this transparently through automatic regional regulatory inspection and NetworkManager self-healing:

1. **Regulatory Parsing & Dynamic Compatibility Matrix**:
   - `parseRegulatoryBands()`: Dynamically extracts authorized frequency ranges from `iw reg get` alongside country code and timezone fallbacks.
   - `isChannelCompatibleWithRegion()`: Evaluates the active upstream channel against local mobile device scanning restrictions (e.g. flagging channels 36–48 and 100–144 under `NG` domain).
2. **Pre-emptive Radio Interface Release**:
   Before modifying upstream frequencies on single-radio chipsets, any active `hostapd` virtual binding on `ap0` is demoted via `hostapd_cli -p /run/hostapd disable` or stopped. This prevents driver `EBUSY` deadlocks during upstream re-association.
3. **Automated Upstream Band Shifting (`switchWifiBand`)**:
   When an incompatible regulatory channel is detected on the active upstream connection, Linksy automatically:
   - Queries the active NetworkManager profile for the physical Wi-Fi interface.
   - Modifies `802-11-wireless.band` to `bg` (2.4 GHz) and clears any hardcoded BSSID locks:
     ```bash
     nmcli connection modify "<connection>" 802-11-wireless.band bg 802-11-wireless.bssid ""
     nmcli connection up "<connection>"
     ```
   - NetworkManager transparently associates with the 2.4 GHz radio of the access point (e.g. Channel 6), without requiring user intervention or manual reconnections.
   - Linksy detects the new 2.4 GHz channel via `getActiveWifiConnection()` and brings up the hotspot on the universally accessible frequency.
4. **Explicit Band Control CLI Overrides**:
   Users can manually control or bypass regulatory band selection using:
   ```bash
   linksy on --wifi --band 2.4   # Force 2.4 GHz band (shorthand: linksy on -w --2ghz)
   linksy on --wifi --band 5     # Force 5 GHz band (shorthand: linksy on -w --5ghz)
   linksy on --wifi --no-auto-band # Bypass automatic regulatory domain band switching
   ```
5. **Integrated Doctor Diagnostics**:
   `linksy doctor` verifies the active upstream link's regulatory compliance, identifying restricted channels before the user attempts to launch the hotspot.

---

## 13. Stale Daemon Socket Collisions (`dnsmasq: Address already in use`) & Resilient Process Lifecycle Management

### 13.1 Symptom
When starting the Wi-Fi hotspot with `linksy on --wifi`, the startup sequence aborts with exit status 2:
```text
ap0: interface state UNINITIALIZED->ENABLED
ap0: AP-ENABLED

dnsmasq: failed to create listening socket for 192.168.42.1: Address already in use
✖ Failed to start Wi-Fi hotspot (exit status: 2).
```
Subsequent attempts to run `linksy off` report:
```text
ℹ Stopping Linksy services...
ℹ No active Linksy services were running.
```
Even though `linksy off` reports no active services, repeating `linksy on --wifi` continuously fails with the exact same socket bind collision error.

### 13.2 Root Cause Analysis
1. **Asymmetric Process Ownership and Privilege Dropping**:
   `hostapd` and `dnsmasq` operate under fundamentally different security models:
   - `hostapd` runs continuously as `root` and writes its PID to `wifi.pid`.
   - `dnsmasq` starts as `root` to bind privileged ports (port 53 for DNS, port 67 for DHCP), but immediately drops privileges to the system `dnsmasq` user and writes its PID to `wifi.pid.dnsmasq`.
2. **Orphaned Daemon Accumulation on Startup Aborts**:
   In `start-hotspot.sh` (executed with `set -e`), operations occur sequentially:
   - Hostapd daemon launch (`hostapd -B -P wifi.pid`).
   - Virtual interface setup and subnet assignment (`192.168.42.1/24` to `ap0`).
   - Dnsmasq daemon launch (`dnsmasq --interface=ap0 ...`).
   If a previous `dnsmasq` instance remained alive or was not cleaned up during an unexpected restart, it retained its active listening socket on `192.168.42.1:53` and UDP broadcast on port 67.
   When the newly spawned `dnsmasq` attempted to bind to `192.168.42.1:53`, the kernel returned `EADDRINUSE`, causing `dnsmasq` to terminate with exit code 2. Because `set -e` was active, the entire script failed immediately, leaving `hostapd` running in the background as an orphan.
3. **PID File Desynchronization and Unprivileged Process Signaling**:
   - Earlier versions of `isHotspotRunning()` and `offCommand()` only tracked `wifi.pid`. If `hostapd` died or was terminated while `dnsmasq` lingered, Linksy assumed the hotspot was completely stopped and refused to trigger `stop-hotspot.sh`.
   - An unprivileged user invoking `kill` or Node's `process.kill()` on the `dnsmasq` process encountered `EPERM` (Operation not permitted) because the process was owned by the `dnsmasq` system user.
   - Without explicit, root-privileged forceful termination (`kill -9` and `pkill -9`), the socket remained in a TIME_WAIT / bound state.

### 13.3 The Resolution & Multi-Layer Architecture (Released in v1.5.1)
Linksy implements a multi-layer defense ensuring zero socket leakage across crashes, reboots, and aborted runs:

1. **Pre-Flight Daemon and Port Sanitation in `start-hotspot.sh`**:
   Before creating interfaces or initializing radios, `start-hotspot.sh` runs as `root` under `sudo` and performs thorough process sweep:
   - Reads `${PID_FILE}.dnsmasq` and issues `kill -9`.
   - Pattern-kills any running `dnsmasq` process bound to the AP interface or Linksy subnet:
     ```bash
     pkill -9 -f "dnsmasq.*--interface=${AP_IFACE}" 2>/dev/null || true
     pkill -9 -f "dnsmasq.*192\.168\.42\." 2>/dev/null || true
     ```
   - Forcefully stops lingering `hostapd` instances (`killall -9 hostapd`).
   - Right before launching `dnsmasq` (Step 7), re-verifies socket cleanliness with an explicit 0.5s settling pause to allow the kernel socket table to clear.
2. **Dual-Daemon State Inspection (`isHotspotRunning`)**:
   `isHotspotRunning()` now inspects both `wifi.pid` (`hostapd`) and `wifi.pid.dnsmasq` (`dnsmasq`). It cleanly interprets `EPERM` as positive confirmation that the daemon is active on the system.
3. **Comprehensive Teardown and Sudo Fallback in `offCommand`**:
   - `linksy off` evaluates `isHotspotRunning()`, `wifi.pid`, `wifi.pid.dnsmasq`, and physical sysfs interface presence (`/sys/class/net/ap0`).
   - `stopWifiHotspot()` runs `stop-hotspot.sh` and executes a direct sudo fallback block, guaranteeing interface deletion, iptables rule purging, and process termination even if static script files on disk were outdated.


