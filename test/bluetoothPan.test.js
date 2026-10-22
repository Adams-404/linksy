import { describe, it, expect } from 'vitest';
import {
  checkBluetoothAvailability,
  getBluetoothControllerPath,
  getBluetoothPanStatus,
  isBluetoothPanRunning,
  generateBluetoothStartScript,
  generateBluetoothStopScript
} from '../src/lib/bluetoothPan.js';

describe('bluetoothPan - status checks', () => {
  it('returns valid status structure for getBluetoothPanStatus', () => {
    const status = getBluetoothPanStatus();
    expect(status).toHaveProperty('running');
    expect(typeof status.running).toBe('boolean');
    expect(status).toHaveProperty('bridge', 'pan0');
  });

  it('checks bluetooth availability cleanly without throwing', () => {
    const check = checkBluetoothAvailability();
    expect(check).toHaveProperty('available');
    expect(typeof check.available).toBe('boolean');
    expect(check).toHaveProperty('powered');
    expect(typeof check.powered).toBe('boolean');
  });

  it('isBluetoothPanRunning returns false by default', () => {
    expect(isBluetoothPanRunning()).toBe(false);
  });
});

describe('bluetoothPan - controller path', () => {
  it('always returns a BlueZ hci object path (never a hardcoded hci0)', () => {
    const path = getBluetoothControllerPath('My Adapter (AA:BB:CC:DD:EE:FF)');
    expect(path).toMatch(/^\/org\/bluez\/hci\d+$/);
  });

  it('returns something usable even without a controller label', () => {
    expect(getBluetoothControllerPath()).toMatch(/^\/org\/bluez\/hci\d+$/);
  });
});

describe('bluetoothPan - script generation', () => {
  const options = {
    upstreamIface: 'wlp0s20f3',
    bridge: 'pan0',
    controllerPath: '/org/bluez/hci1'
  };

  it('registers the NAP server on the detected controller and reuses the firewall layer', () => {
    const script = generateBluetoothStartScript(options);

    expect(script).toContain('IFACE="wlp0s20f3"');
    expect(script).toContain('BRIDGE="pan0"');
    expect(script).toContain(
      'busctl call org.bluez "/org/bluez/hci1" org.bluez.NetworkServer1 Register'
    );
    expect(script).not.toContain('/org/bluez/hci0');

    // Shared firewall/NAT layer: iptables-first with an nftables fallback.
    expect(script).toContain('for _candidate in iptables iptables-nft; do');
    expect(script).toContain('"$IPT_BIN" -w 5 "$@"');
    expect(script).toContain('add table ip linksy_nat');
    expect(script).toContain('nft_drop_chains forward');

    // The PAN subnet, not the Wi-Fi subnet, must be masqueraded.
    expect(script).toContain('ip saddr 10.42.0.0/24 masquerade');
    expect(script).not.toContain('ip saddr 192.168.42.0/24 masquerade');

    // DHCP hands out the bridge address as gateway and DNS.
    expect(script).toContain('--dhcp-range=10.42.0.10,10.42.0.100');
    expect(script).toContain('--dhcp-option=3,10.42.0.1');
    expect(script).toContain('--dhcp-option=6,10.42.0.1');

    // Runtime files must be readable/writable by the privilege-dropping dnsmasq.
    expect(script).toContain('/run/linksy/bt-dnsmasq.pid');
    expect(script).toContain('/run/linksy/bt-dnsmasq.leases');
    expect(script).toContain('chmod 666');

    // DNS discovery, with public resolvers only as a last resort.
    expect(script).toContain('--resolv-file="$RUN_DIR/upstream-dns.conf"');
    expect(script).toContain('if [ -z "$DNS_SERVERS" ]; then');
    expect(script).toContain('DNSMASQ_FALLBACK_SERVERS="--server=1.1.1.1 --server=8.8.8.8"');

    // Fail loudly instead of leaving the phone connected with no IP.
    expect(script).toContain('dnsmasq failed to start');
    expect(script).toContain('dnsmasq did not stay running');
    expect(script).not.toContain('undefined');
  });

  it('tears down the daemon, NAP registration, firewall rules and bridge', () => {
    const script = generateBluetoothStopScript(options);

    expect(script).toContain('IFACE="wlp0s20f3"');
    expect(script).toContain('AP_IFACE="$BRIDGE"');
    expect(script).toContain(
      'busctl call org.bluez "/org/bluez/hci1" org.bluez.NetworkServer1 Unregister'
    );
    expect(script).toContain('/run/linksy/bt-dnsmasq.pid');
    expect(script).toContain('bluetooth.pid');
    expect(script).toContain('ipt_del_all -t nat -D POSTROUTING -o "$_uplink" -j MASQUERADE');
    expect(script).toContain('nft delete table ip linksy_nat');
    expect(script).toContain('ip link delete "$BRIDGE" type bridge');
    expect(script).not.toContain('undefined');
  });
});
