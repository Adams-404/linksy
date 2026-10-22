import fs from 'node:fs';
import { execSync } from 'node:child_process';
import {
  RUN_DIR,
  WIFI_STATE_FILE,
  WIFI_DNSMASQ_LEASES_FILE,
  WIFI_DNSMASQ_PID_FILE
} from './paths.js';

/**
 * Firewall / NAT support for Linksy.
 *
 * Linksy turns a laptop into an internet gateway, which means it must add NAT
 * and forwarding rules on whatever firewall stack the distribution ships:
 *
 *   - Fedora / RHEL: firewalld on top of iptables-nft (or native nftables)
 *   - Ubuntu / Debian: iptables (nft backend since 20.04), ufw often enabled
 *   - Kali: iptables is Priority "optional", nftables is "important", so a
 *     minimal/headless/ARM/WSL Kali can have nftables but no iptables at all
 *
 * Historically Linksy hardcoded iptables and only knew about firewalld. On a
 * Kali machine with ufw, a drop-policy nftables ruleset, or no iptables
 * binary, the hotspot came up and the phone got DHCP but no internet.
 *
 * This module keeps the Node-side detection helpers (used by doctor/status and
 * dependency installation) plus the shell snippets that the elevated start and
 * stop scripts embed. Everything pure is exported so it can be unit tested.
 */

/**
 * Extracts the interface used by the default IPv4 route.
 * @param {string} routeText Output of `ip -4 route show default`.
 * @returns {string|null}
 */
export function parseDefaultRouteInterface(routeText) {
  if (!routeText || typeof routeText !== 'string') return null;

  for (const rawLine of routeText.split('\n')) {
    const line = rawLine.trim();
    if (!/^default(\s|$)/.test(line)) continue;
    const match = line.match(/\bdev\s+(\S+)/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Returns true when an address is a usable upstream DNS server.
 * Loopback stubs (127.0.0.53), link-local and unspecified addresses are
 * rejected because dnsmasq would forward queries into a black hole.
 * @param {string} ip
 * @returns {boolean}
 */
export function isUsableNameserver(ip) {
  if (typeof ip !== 'string') return false;
  const value = ip.trim().toLowerCase().replace(/%.+$/, '');
  if (!value) return false;
  if (!/^[0-9a-f:.]+$/.test(value)) return false;
  if (value === '::1' || value === '::' || value === '0.0.0.0') return false;
  if (value.startsWith('127.')) return false;
  if (value.startsWith('fe80:')) return false;
  if (value.startsWith('169.254.')) return false;
  if (value.includes(':') && !value.includes('.')) {
    // Only accept non-loopback IPv6 (global or ULA). Anything starting with
    // fd/fc is a ULA, 2xxx/3xxx global unicast; keep it simple and allow those.
    if (!/^(2|3|f[cd])/.test(value)) return false;
  }
  return true;
}

/**
 * Parses `nameserver` entries from a resolv.conf style file.
 * @param {string} resolvText
 * @returns {string[]}
 */
export function parseNameservers(resolvText) {
  const servers = [];
  if (!resolvText || typeof resolvText !== 'string') return servers;

  for (const rawLine of resolvText.split('\n')) {
    const match = rawLine.match(/^\s*nameserver\s+(\S+)/i);
    if (!match) continue;
    if (!isUsableNameserver(match[1])) continue;
    const ip = match[1].trim();
    if (!servers.includes(ip)) servers.push(ip);
  }

  return servers;
}

/**
 * Parses `nmcli -t -f IP4.DNS,IP6.DNS device show` output.
 * Needed because /etc/resolv.conf may point at a local stub while
 * NetworkManager knows the real upstream servers.
 * @param {string} output
 * @returns {string[]}
 */
export function parseNmcliDns(output) {
  const servers = [];
  if (!output || typeof output !== 'string') return servers;

  for (const rawLine of output.split('\n')) {
    const match = rawLine.match(/^IP[46]\.DNS(\[\d+\])?:\s*(.+)$/);
    if (!match) continue;
    const ip = match[2].trim();
    if (!isUsableNameserver(ip)) continue;
    if (!servers.includes(ip)) servers.push(ip);
  }

  return servers;
}

/**
 * Builds the ordered, de-duplicated list of interfaces that may carry the
 * internet connection. The Wi-Fi interface is included even when it is not the
 * default route (multi-homed laptops), and vice versa (VPN / VM / USB modem).
 * @param {{ iface?: string, defaultRouteIface?: string, apIface?: string }} options
 * @returns {string[]}
 */
export function buildUplinkList({ iface, defaultRouteIface, apIface = 'ap0' } = {}) {
  const uplinks = [];
  const excluded = new Set(['lo', 'pan0', apIface]);

  for (const candidate of [iface, defaultRouteIface]) {
    if (typeof candidate !== 'string') continue;
    const name = candidate.trim();
    if (!name || excluded.has(name)) continue;
    if (!uplinks.includes(name)) uplinks.push(name);
  }

  return uplinks;
}

/**
 * Finds base chains that hook into a given netfilter hook and default to a
 * drop policy. Parses `nft list ruleset` text.
 * @param {string} rulesetText
 * @param {'forward'|'input'|'output'} hook
 * @returns {Array<{ family: string, table: string, chain: string }>}
 */
export function parseNftDropChains(rulesetText, hook = 'forward') {
  const chains = [];
  if (!rulesetText || typeof rulesetText !== 'string') return chains;

  // nft prints one rule per line, but a whole chain can also be written on a
  // single line. Splitting on braces and semicolons normalises both forms.
  const lines = rulesetText.replace(/([{};])/g, '$1\n').split('\n');

  let family = null;
  let table = null;
  let chain = null;
  let wantsHook = false;

  const addChain = () => {
    if (!family || !table || !chain || !wantsHook) return;
    if (chains.some(c => c.family === family && c.table === table && c.chain === chain)) return;
    chains.push({ family, table, chain });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const tableMatch = line.match(/^table\s+(\S+)\s+(\S+)/);
    if (tableMatch) {
      family = tableMatch[1];
      table = tableMatch[2];
      chain = null;
      wantsHook = false;
      continue;
    }

    const chainMatch = line.match(/^chain\s+(\S+)/);
    if (chainMatch) {
      chain = chainMatch[1];
      wantsHook = false;
      continue;
    }

    if (chain && new RegExp(`hook\\s+${hook}(\\s|$)`).test(line)) {
      wantsHook = true;
      continue;
    }

    if (chain && wantsHook && /policy\s+drop/.test(line)) {
      addChain();
    }
  }

  return chains;
}

/**
 * @param {string} rulesetText
 * @returns {Array<{ family: string, table: string, chain: string }>}
 */
export function parseNftForwardDropChains(rulesetText) {
  return parseNftDropChains(rulesetText, 'forward');
}

/**
 * Parses the Linksy runtime state file written by start-hotspot.sh.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseStateFile(text) {
  const state = {};
  if (!text || typeof text !== 'string') return state;

  for (const rawLine of text.split('\n')) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    state[match[1]] = match[2].trim();
  }

  return state;
}

function commandExists(command) {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {boolean}
 */
export function isIptablesInstalled() {
  if (commandExists('iptables') || commandExists('iptables-nft')) return true;
  return fs.existsSync('/usr/sbin/iptables') ||
    fs.existsSync('/sbin/iptables') ||
    fs.existsSync('/usr/sbin/iptables-nft');
}

/**
 * @returns {boolean}
 */
export function isNftInstalled() {
  if (commandExists('nft')) return true;
  return fs.existsSync('/usr/sbin/nft') || fs.existsSync('/sbin/nft') || fs.existsSync('/usr/bin/nft');
}

/**
 * Linksy can set up NAT with either iptables or nftables.
 * @returns {boolean}
 */
export function isFirewallToolInstalled() {
  return isIptablesInstalled() || isNftInstalled();
}

/**
 * Detects whether the installed iptables talks to the legacy or nft backend.
 * @returns {'nft'|'legacy'|'unknown'|null}
 */
export function getIptablesBackend() {
  for (const binary of ['iptables', 'iptables-nft']) {
    try {
      const output = execSync(`${binary} --version`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      if (/nf_tables/i.test(output)) return 'nft';
      if (/legacy/i.test(output)) return 'legacy';
      return 'unknown';
    } catch {
      // try the next binary
    }
  }

  return null;
}

/**
 * @returns {boolean}
 */
export function isUfwActive() {
  if (!commandExists('ufw')) return false;
  try {
    const output = execSync('ufw status', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return /^Status:\s*active/im.test(output);
  } catch {
    return false;
  }
}

/**
 * @returns {boolean}
 */
export function isFirewalldActive() {
  if (!commandExists('firewall-cmd')) return false;
  try {
    execSync('systemctl is-active --quiet firewalld', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Summarises the firewall tooling available on this machine.
 * @returns {{ iptables: boolean, iptablesBackend: string|null, nft: boolean, ufwActive: boolean, firewalldActive: boolean, backend: 'iptables'|'nft'|'none' }}
 */
export function detectFirewallStack() {
  const iptables = isIptablesInstalled();
  const nft = isNftInstalled();

  return {
    iptables,
    iptablesBackend: iptables ? getIptablesBackend() : null,
    nft,
    ufwActive: isUfwActive(),
    firewalldActive: isFirewalldActive(),
    backend: iptables ? 'iptables' : nft ? 'nft' : 'none'
  };
}

/**
 * Package name that provides an iptables binary for a given package manager.
 * @param {string|null} pmType
 * @returns {string|null}
 */
export function getFirewallPackageName(pmType) {
  switch (pmType) {
    case 'apt':
      return 'iptables';
    case 'dnf':
      return 'iptables-nft';
    case 'pacman':
      return 'iptables-nft';
    case 'zypper':
      return 'iptables';
    default:
      return null;
  }
}

/**
 * Reads the state file written by the running hotspot.
 * @returns {Record<string, string>}
 */
export function readFirewallState() {
  try {
    if (!fs.existsSync(WIFI_STATE_FILE)) return {};
    return parseStateFile(fs.readFileSync(WIFI_STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Shell function that lists nftables base chains with a drop policy for a hook.
 * Kept as its own generator so it can be tested against real `nft` output.
 * @returns {string}
 */
export function generateNftDropChainsFunction() {
  return `nft_drop_chains() {
  [ -n "$NFT_BIN" ] || return 0
  "$NFT_BIN" -a list ruleset 2>/dev/null | awk -v hook="$1" '
    /^table / { family = $2; table = $3; chain = ""; want = 0 }
    /^[[:space:]]*chain / { chain = $2; want = 0; next }
    $0 ~ ("hook[[:space:]]+" hook "([[:space:]]|;|$)") { want = 1 }
    want && /policy[[:space:]]+drop/ { print family, table, chain }
  ' | sort -u
}`;
}

/**
 * Shell snippet: firewall, forwarding and NAT setup.
 * Expects AP_IFACE, IFACE and DENY_FILE to be defined by the caller.
 * @param {{ subnet?: string }} [options] Hotspot subnet, used by the nftables
 *   fallback (the Wi-Fi hotspot uses 192.168.42.0/24, Bluetooth PAN 10.42.0.0/24).
 * @returns {string}
 */
export function generateFirewallSetupScript({ subnet = '192.168.42.0/24' } = {}) {
  return `# --- Linksy firewall / NAT setup (distribution independent) ---
RUN_DIR="${RUN_DIR}"
STATE_FILE="${WIFI_STATE_FILE}"
LEASES_FILE="${WIFI_DNSMASQ_LEASES_FILE}"
DNSMASQ_PID_FILE="${WIFI_DNSMASQ_PID_FILE}"
mkdir -p "$RUN_DIR" 2>/dev/null || true
chmod 755 "$RUN_DIR" 2>/dev/null || true

# Pick an iptables binary. Kali marks iptables as "optional" and nftables as
# "important", so a minimal Kali install can have no iptables at all.
IPT_BIN=""
for _candidate in iptables iptables-nft; do
  if command -v "$_candidate" >/dev/null 2>&1; then
    IPT_BIN="$(command -v "$_candidate")"
    break
  fi
done

# -w 5 waits for the xtables lock instead of dying on lock contention.
ipt() {
  if [ -z "$IPT_BIN" ]; then
    return 127
  fi
  "$IPT_BIN" -w 5 "$@"
}

# Remove every copy of a rule so re-running the script is idempotent.
ipt_del_all() {
  _n=0
  while [ "$_n" -lt 8 ] && ipt "$@" 2>/dev/null; do
    _n=$((_n + 1))
  done
  return 0
}

NFT_BIN=""
if command -v nft >/dev/null 2>&1; then
  NFT_BIN="$(command -v nft)"
fi

# The interface carrying internet is not always the Wi-Fi uplink (VPN tun0,
# VM NAT eth0, USB modem). Treat the default-route device as an uplink too.
DEFAULT_ROUTE_IFACE="$(ip -4 route show default 2>/dev/null | awk '/^default/ {for (i = 1; i <= NF; i++) if ($i == "dev") {print $(i + 1); exit}}')"
UPLINKS=""
add_uplink() {
  [ -n "$1" ] || return 0
  [ "$1" = "lo" ] && return 0
  [ "$1" = "$AP_IFACE" ] && return 0
  case ",$UPLINKS," in
    *",$1,"*) return 0 ;;
  esac
  UPLINKS="\${UPLINKS:+\${UPLINKS},}$1"
}
add_uplink "$IFACE"
add_uplink "$DEFAULT_ROUTE_IFACE"
[ -n "$UPLINKS" ] || UPLINKS="$IFACE"
UPLINK="$(echo "$UPLINKS" | cut -d, -f1)"

# Forwarding must be on or NAT silently does nothing.
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
FORWARDING="$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null || echo 0)"

# --- Host firewalls that default to dropping forwarded traffic ---
FIREWALL="none"
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld >/dev/null 2>&1; then
  FIREWALL="firewalld"
  firewall-cmd --zone=trusted --add-interface="$AP_IFACE" >/dev/null 2>&1 || true
fi
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status:[[:space:]]*active'; then
  FIREWALL="ufw"
  ufw allow in on "$AP_IFACE" >/dev/null 2>&1 || true
  for _uplink in \${UPLINKS//,/ }; do
    ufw route allow in on "$AP_IFACE" out on "$_uplink" >/dev/null 2>&1 || true
    ufw route allow in on "$_uplink" out on "$AP_IFACE" >/dev/null 2>&1 || true
  done
fi

# --- nftables drop-policy holes ---
# nftables is installed by default on Kali. If a table hooks forward/input with
# "policy drop", a packet is dropped by the first matching base chain no matter
# what iptables accepts, so punch explicit holes for our subnet.
${generateNftDropChainsFunction()}

if [ -n "$NFT_BIN" ]; then
  nft_drop_chains forward | while read -r _family _table _chain; do
    [ -n "$_chain" ] || continue
    for _uplink in \${UPLINKS//,/ }; do
      "$NFT_BIN" add rule "$_family" "$_table" "$_chain" iifname "$AP_IFACE" oifname "$_uplink" accept comment "linksy" 2>/dev/null || true
      "$NFT_BIN" add rule "$_family" "$_table" "$_chain" iifname "$_uplink" oifname "$AP_IFACE" ct state related,established accept comment "linksy" 2>/dev/null || true
    done
  done
  nft_drop_chains input | while read -r _family _table _chain; do
    [ -n "$_chain" ] || continue
    # Replies to the host's own traffic (upstream DNS queries, updates) arrive
    # on the uplink, so allow established traffic there too.
    for _uplink in \${UPLINKS//,/ }; do
      "$NFT_BIN" add rule "$_family" "$_table" "$_chain" iifname "$_uplink" ct state related,established accept comment "linksy" 2>/dev/null || true
    done
    "$NFT_BIN" add rule "$_family" "$_table" "$_chain" iifname "$AP_IFACE" udp dport 67-68 accept comment "linksy" 2>/dev/null || true
    "$NFT_BIN" add rule "$_family" "$_table" "$_chain" iifname "$AP_IFACE" udp dport 53 accept comment "linksy" 2>/dev/null || true
    "$NFT_BIN" add rule "$_family" "$_table" "$_chain" iifname "$AP_IFACE" tcp dport 53 accept comment "linksy" 2>/dev/null || true
    "$NFT_BIN" add rule "$_family" "$_table" "$_chain" iifname "$AP_IFACE" icmp type { echo-request, echo-reply } accept comment "linksy" 2>/dev/null || true
  done
fi

# --- NAT + forwarding rules ---
NAT_BACKEND="none"
NAT_OK=0

if [ -n "$IPT_BIN" ]; then
  NAT_BACKEND="iptables"

  # Drop stale Linksy rules from a previous or interrupted run first.
  ipt_del_all -D INPUT -i "$AP_IFACE" -p udp --dport 67:68 --sport 67:68 -j ACCEPT
  ipt_del_all -D INPUT -i "$AP_IFACE" -p udp --dport 53 -j ACCEPT
  ipt_del_all -D INPUT -i "$AP_IFACE" -p tcp --dport 53 -j ACCEPT
  ipt_del_all -D INPUT -i "$AP_IFACE" -p icmp -j ACCEPT
  ipt_del_all -D FORWARD -i "$AP_IFACE" -p icmp -j ACCEPT
  ipt_del_all -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
  for _uplink in \${UPLINKS//,/ }; do
    ipt_del_all -D FORWARD -i "$AP_IFACE" -o "$_uplink" -j ACCEPT
    ipt_del_all -D FORWARD -i "$_uplink" -o "$AP_IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
    ipt_del_all -D FORWARD -i "$_uplink" -o "$AP_IFACE" -m state --state RELATED,ESTABLISHED -j ACCEPT
    ipt_del_all -t nat -D POSTROUTING -o "$_uplink" -j MASQUERADE
  done

  # DHCP, DNS and ICMP must reach the host from the hotspot subnet.
  ipt -I INPUT -i "$AP_IFACE" -p udp --dport 67:68 --sport 67:68 -j ACCEPT 2>/dev/null || true
  ipt -I INPUT -i "$AP_IFACE" -p udp --dport 53 -j ACCEPT 2>/dev/null || true
  ipt -I INPUT -i "$AP_IFACE" -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
  ipt -I INPUT -i "$AP_IFACE" -p icmp -j ACCEPT 2>/dev/null || true
  ipt -I FORWARD -i "$AP_IFACE" -p icmp -j ACCEPT 2>/dev/null || true

  # Clamp TCP MSS so phones never hit a PMTU black hole (Windows clients).
  ipt -t mangle -I FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

  for _uplink in \${UPLINKS//,/ }; do
    ipt -I FORWARD -i "$AP_IFACE" -o "$_uplink" -j ACCEPT 2>/dev/null || true
    ipt -I FORWARD -i "$_uplink" -o "$AP_IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
    ipt -t nat -A POSTROUTING -o "$_uplink" -j MASQUERADE 2>/dev/null || true
  done

  if ipt -t nat -C POSTROUTING -o "$UPLINK" -j MASQUERADE 2>/dev/null; then
    NAT_OK=1
  fi
else
  # No iptables at all (minimal Kali / headless images): use nftables directly.
  NAT_BACKEND="none"
  if [ -n "$NFT_BIN" ]; then
    NAT_BACKEND="nft"
    "$NFT_BIN" add table ip linksy_nat 2>/dev/null || true
    "$NFT_BIN" add chain ip linksy_nat postrouting '{ type nat hook postrouting priority srcnat; policy accept; }' 2>/dev/null || true
    "$NFT_BIN" flush chain ip linksy_nat postrouting 2>/dev/null || true
    for _uplink in \${UPLINKS//,/ }; do
      "$NFT_BIN" add rule ip linksy_nat postrouting oifname "$_uplink" ip saddr ${subnet} masquerade comment "linksy" 2>/dev/null || true
    done

    "$NFT_BIN" add table ip linksy_filter 2>/dev/null || true
    "$NFT_BIN" add chain ip linksy_filter forward '{ type filter hook forward priority filter; policy accept; }' 2>/dev/null || true
    "$NFT_BIN" add chain ip linksy_filter input '{ type filter hook input priority filter; policy accept; }' 2>/dev/null || true
    "$NFT_BIN" flush chain ip linksy_filter forward 2>/dev/null || true
    "$NFT_BIN" flush chain ip linksy_filter input 2>/dev/null || true
    for _uplink in \${UPLINKS//,/ }; do
      "$NFT_BIN" add rule ip linksy_filter forward iifname "$AP_IFACE" oifname "$_uplink" accept comment "linksy" 2>/dev/null || true
      "$NFT_BIN" add rule ip linksy_filter forward iifname "$_uplink" oifname "$AP_IFACE" ct state related,established accept comment "linksy" 2>/dev/null || true
    done
    "$NFT_BIN" add rule ip linksy_filter forward tcp flags syn tcp option maxseg size set rt mtu comment "linksy" 2>/dev/null || true
    for _uplink in \${UPLINKS//,/ }; do
      "$NFT_BIN" add rule ip linksy_filter input iifname "$_uplink" ct state related,established accept comment "linksy" 2>/dev/null || true
    done
    "$NFT_BIN" add rule ip linksy_filter input iifname "$AP_IFACE" udp dport 67-68 accept comment "linksy" 2>/dev/null || true
    "$NFT_BIN" add rule ip linksy_filter input iifname "$AP_IFACE" udp dport 53 accept comment "linksy" 2>/dev/null || true
    "$NFT_BIN" add rule ip linksy_filter input iifname "$AP_IFACE" tcp dport 53 accept comment "linksy" 2>/dev/null || true
    "$NFT_BIN" add rule ip linksy_filter input iifname "$AP_IFACE" icmp type { echo-request, echo-reply } accept comment "linksy" 2>/dev/null || true

    if "$NFT_BIN" list chain ip linksy_nat postrouting 2>/dev/null | grep -q masquerade; then
      NAT_OK=1
    fi
  fi
fi

if [ "$NAT_BACKEND" = "none" ]; then
  echo "Linksy: no firewall/NAT tool found (neither iptables nor nftables is installed)." >&2
  echo "Linksy: your phone would connect but get no internet. Install one and retry:" >&2
  echo "Linksy:   Kali/Debian/Ubuntu: sudo apt install iptables" >&2
  echo "Linksy:   Fedora: sudo dnf install iptables-nft" >&2
  exit 1
fi

# A masquerade rule is useless while IPv4 forwarding is off, so a hotspot is
# only "verified" when both are true. Otherwise status would claim success
# while phones still had no internet.
if [ "$FORWARDING" != "1" ]; then
  NAT_OK=0
  echo "Linksy: IPv4 forwarding is disabled and could not be enabled." >&2
  echo "Linksy: run 'sudo sysctl -w net.ipv4.ip_forward=1' and check that /proc is writable." >&2
fi

# Apply the device block list with whichever backend we selected.
if [ -n "$IPT_BIN" ] && [ -f "$DENY_FILE" ]; then
  while read -r mac; do
    mac=$(echo "$mac" | tr -d '\\r\\n ')
    if [ -n "$mac" ]; then
      ipt_del_all -D INPUT -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP
      ipt_del_all -D FORWARD -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP
      ipt -I INPUT -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP 2>/dev/null || true
      ipt -I FORWARD -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP 2>/dev/null || true
    fi
  done < "$DENY_FILE"
fi
`;
}

/**
 * Shell snippet: upstream DNS discovery plus the Linksy-managed resolv file.
 * Expects AP_IFACE to be defined by the caller.
 * @returns {string}
 */
export function generateDnsDiscoveryScript() {
  return `# --- Upstream DNS discovery ---
# Kali has no systemd-resolved, and some systems make /etc/resolv.conf a stub
# pointing at 127.0.0.53. Read the NetworkManager copy first, then whatever
# else exists, and ignore loopback/link-local entries.
DNS_SERVERS=""
add_dns_server() {
  case "$1" in
    # Never forward to ourselves, and skip loopback stubs / link-local.
    ''|127.*|::1|::|0.0.0.0|fe80:*|169.254.*|192.168.42.1|10.42.0.1) return 0 ;;
  esac
  case " $DNS_SERVERS " in
    *" $1 "*) return 0 ;;
  esac
  DNS_SERVERS="$DNS_SERVERS $1"
}

for DNS_FILE in /run/NetworkManager/resolv.conf /run/systemd/resolve/resolv.conf /etc/resolv.conf; do
  [ -r "$DNS_FILE" ] || continue
  while read -r _ns_ip; do
    [ -n "$_ns_ip" ] && add_dns_server "$_ns_ip"
  done <<DNS_EOF
$(awk '/^[[:space:]]*nameserver[[:space:]]/ {print $2}' "$DNS_FILE" 2>/dev/null)
DNS_EOF
done

if command -v nmcli >/dev/null 2>&1; then
  while IFS= read -r _ns_ip; do
    [ -n "$_ns_ip" ] && add_dns_server "$_ns_ip"
  done <<DNS_EOF
$(nmcli -t -f IP4.DNS,IP6.DNS device show 2>/dev/null | sed -n 's/^IP[46]\\.DNS\\(\\[[0-9]*\\]\\)\\{0,1\\}:\\(.*\\)$/\\2/p')
DNS_EOF
fi

DNS_SERVERS="$(echo "$DNS_SERVERS" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

# dnsmasq drops privileges after startup on most distributions, so its files
# live in /run/linksy (mode 755) instead of the user's private home directory.
mkdir -p "$RUN_DIR" 2>/dev/null || true
chmod 755 "$RUN_DIR" 2>/dev/null || true
: > "$RUN_DIR/upstream-dns.conf" 2>/dev/null || true
chmod 644 "$RUN_DIR/upstream-dns.conf" 2>/dev/null || true
for _ns_ip in $DNS_SERVERS; do
  echo "nameserver $_ns_ip" >> "$RUN_DIR/upstream-dns.conf" 2>/dev/null || true
done
`;
}

/**
 * Shell snippet: writes the runtime state file read by status/doctor.
 * Expects all state variables to be defined by the caller.
 * @returns {string}
 */
export function generateStateWriteScript() {
  return `# --- Record how the hotspot was set up (read by linksy status/doctor) ---
mkdir -p "$RUN_DIR" 2>/dev/null || true
{
  echo "AP_IFACE=$AP_IFACE"
  echo "UPLINKS=$UPLINKS"
  echo "UPLINK=$UPLINK"
  echo "NAT_BACKEND=$NAT_BACKEND"
  echo "NAT_OK=$NAT_OK"
  echo "FIREWALL=$FIREWALL"
  echo "FORWARDING=$FORWARDING"
  echo "DNS_SERVERS=$DNS_SERVERS"
  echo "DNSMASQ_RUNNING=$DNSMASQ_RUNNING"
  echo "UPDATED_AT=$(date +%s 2>/dev/null || echo 0)"
} > "$STATE_FILE" 2>/dev/null || true
chmod 644 "$STATE_FILE" 2>/dev/null || true
`;
}

/**
 * Shell snippet: removes every rule the setup script added.
 * Expects IFACE and AP_IFACE to be defined by the caller.
 * @returns {string}
 */
export function generateFirewallTeardownScript() {
  return `# --- Linksy firewall / NAT teardown ---
RUN_DIR="${RUN_DIR}"
STATE_FILE="${WIFI_STATE_FILE}"
mkdir -p "$RUN_DIR" 2>/dev/null || true
state_value() {
  sed -n "s/^$1=//p" "$STATE_FILE" 2>/dev/null | head -n 1
}

IPT_BIN=""
for _candidate in iptables iptables-nft; do
  if command -v "$_candidate" >/dev/null 2>&1; then
    IPT_BIN="$(command -v "$_candidate")"
    break
  fi
done
ipt() {
  if [ -z "$IPT_BIN" ]; then
    return 127
  fi
  "$IPT_BIN" -w 5 "$@"
}
ipt_del_all() {
  _n=0
  while [ "$_n" -lt 8 ] && ipt "$@" 2>/dev/null; do
    _n=$((_n + 1))
  done
  return 0
}

# Clean the uplinks recorded at start time plus the current default-route
# device, so rules survive a changed network setup.
DEFAULT_ROUTE_IFACE="$(ip -4 route show default 2>/dev/null | awk '/^default/ {for (i = 1; i <= NF; i++) if ($i == "dev") {print $(i + 1); exit}}')"
UPLINK_LIST="$(state_value UPLINKS | tr ',' ' ') $IFACE $DEFAULT_ROUTE_IFACE"
UPLINK_LIST="$(echo "$UPLINK_LIST" | tr ' ' '\\n' | grep -v -x -e '' -e 'lo' -e "$AP_IFACE" -e '[[:space:]]*' | awk '!seen[$0]++' | tr '\\n' ' ')"

if [ -n "$IPT_BIN" ]; then
  ipt_del_all -D INPUT -i "$AP_IFACE" -p udp --dport 67:68 --sport 67:68 -j ACCEPT
  ipt_del_all -D INPUT -i "$AP_IFACE" -p udp --dport 53 -j ACCEPT
  ipt_del_all -D INPUT -i "$AP_IFACE" -p tcp --dport 53 -j ACCEPT
  ipt_del_all -D INPUT -i "$AP_IFACE" -p icmp -j ACCEPT
  ipt_del_all -D FORWARD -i "$AP_IFACE" -p icmp -j ACCEPT
  ipt_del_all -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
  for _uplink in $UPLINK_LIST; do
    ipt_del_all -D FORWARD -i "$AP_IFACE" -o "$_uplink" -j ACCEPT
    ipt_del_all -D FORWARD -i "$_uplink" -o "$AP_IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
    ipt_del_all -D FORWARD -i "$_uplink" -o "$AP_IFACE" -m state --state RELATED,ESTABLISHED -j ACCEPT
    ipt_del_all -t nat -D POSTROUTING -o "$_uplink" -j MASQUERADE
  done

  if [ -f "$DENY_FILE" ]; then
    while read -r mac; do
      mac=$(echo "$mac" | tr -d '\\r\\n ')
      if [ -n "$mac" ]; then
        ipt_del_all -D INPUT -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP
        ipt_del_all -D FORWARD -i "$AP_IFACE" -m mac --mac-source "$mac" -j DROP
      fi
    done < "$DENY_FILE"
  fi
fi

# --- Remove ufw rules ---
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status:[[:space:]]*active'; then
  ufw delete allow in on "$AP_IFACE" >/dev/null 2>&1 || true
  for _uplink in $UPLINK_LIST; do
    ufw route delete allow in on "$AP_IFACE" out on "$_uplink" >/dev/null 2>&1 || true
    ufw route delete allow in on "$_uplink" out on "$AP_IFACE" >/dev/null 2>&1 || true
  done
fi

# --- Remove nftables rules and Linksy-owned tables ---
if command -v nft >/dev/null 2>&1; then
  nft -a list ruleset 2>/dev/null | awk '
    /^[[:space:]]*table / { family = $2; table = $3 }
    /^[[:space:]]*chain / { chain = $2 }
    /comment "linksy"/ {
      if (match($0, /# handle [0-9]+/)) {
        print family, table, chain, substr($0, RSTART + 9)
      }
    }
  ' | while read -r _family _table _chain _handle; do
    [ -n "$_handle" ] || continue
    nft delete rule "$_family" "$_table" "$_chain" handle "$_handle" 2>/dev/null || true
  done
  nft delete table ip linksy_nat 2>/dev/null || true
  nft delete table ip linksy_filter 2>/dev/null || true
fi

rm -f "$STATE_FILE" 2>/dev/null || true
`;
}
