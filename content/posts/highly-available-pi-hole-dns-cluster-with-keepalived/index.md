+++
draft = false
slug = "highly-available-pi-hole-dns-cluster-with-keepalived" # Overrides the URL path for this page 
type = "post" # Other types are also possible like "rtd", "travel", etc.
in_search_index = true
title = "Setting Up a Highly Available Pi-hole DNS Cluster with Keepalived"
description = "A highly available Pi-hole DNS setup using keepalived and VRRP - automatic failover between two nodes with floating virtual IPs, so your network never loses DNS."
date = 2026-07-01
updated = 2026-07-10

[extra]
katex = false
mermaid = false
toc = true # Generates Table of Contents for the page if true
featured = true
license = "CC-BY-SA-4.0"
wrap_code = false

# og_preview_img = "/images/sample-image.jpeg"    #Uncomment this to add your own OG preview image or let the python script generate one for you for OG images.
# cover_image = "/images/sample-image.jpeg"

[taxonomies]
post_tags = ["post", "pi-hole", "keepalived", "dns", "home-lab"]
+++

## Background

If you're running Pi-hole as the DNS resolver for your home network, you've probably run into the obvious single point of failure: when that one Raspberry Pi goes down for an update, a reboot, or an SD card failure, every device on your network loses DNS resolution. No DNS, no internet - even devices that don't rely on Pi-hole for ad-blocking still need it to resolve hostnames.

The fix is to run two Pi-hole nodes in an **active-active high-availability cluster**, using **keepalived** and the VRRP protocol to manage automatic failover between them. This post walks through exactly how to set that up.


{% <admonition kind="note"> %}
None of this is Raspberry Pi–specific. Any pair of machines running a Debian-based OS works - old laptops, mini PCs, VMs, whatever you have lying around. I have used a pair of Raspberry Pi 4Bs (1GB RAM) running DietPi OS, but the steps translate directly to any Debian/Ubuntu-based setup.
{% </admonition> %}


---

## The Core Idea

Instead of pointing your router at a single Pi-hole IP, you create two **Virtual IPs (VIPs)** - floating addresses that keepalived moves between nodes automatically. Each node is the preferred owner ("master") of one VIP and acts as the backup for the other. That gives you:

- **Active-active load distribution** - both nodes handle real traffic under normal conditions, since your router's primary and secondary DNS point at different VIPs.
- **Automatic failover** - if one node's Pi-hole service (or the node itself) goes down, its peer detects the failure and takes over both VIPs within seconds.
- **No manual intervention** - VRRP handles election and failback automatically, including a configurable delay before a recovered node reclaims its VIP, avoiding flapping.

## Example Network Layout

| Role | Hostname | Static IP | Owns VIP (Master) | Backs Up VIP |
|---|---|---|---|---|
| Node 1 | `dns1` | `192.168.0.10` | `192.168.0.12` (VIP1) | `192.168.0.13` (VIP2) |
| Node 2 | `dns2` | `192.168.0.11` | `192.168.0.13` (VIP2) | `192.168.0.12` (VIP1) |

On your router, set:
- **Primary DNS** → `192.168.0.12`
- **Secondary DNS** → `192.168.0.13`

Both VIPs are always reachable - they just live on whichever node currently holds them.

---

## Prerequisites

- Two machines running a Debian-based OS (Raspberry Pi, mini PC, VM - anything works), each with a static IP reserved on your router
- Pi-hole installed and configured identically on both nodes (blocklists, upstream DNS, etc. - use Pi-hole's Teleporter export/import to keep them in sync)
- Root/sudo access on both nodes

---

## Step 1: Create a Health-Check DNS Record

Keepalived needs a reliable way to verify that DNS resolution is actually *working* on a node - not just that the `pihole-FTL` process is running. The cleanest way to do this is to create a local DNS record that keepalived can query on every health check.

In the Pi-hole web UI, go to **Settings → Local DNS → DNS Records** and add:

| Domain | IP Address |
|---|---|
| `dns-probe.internal` | `127.0.0.1` |

Repeat this on **both nodes**. Keepalived's health check script will query this record locally; if it stops resolving, the node's VRRP priority drops and its peer takes over.

> `.internal` is an IANA-reserved TLD for private use, making it a safe choice for local-only records that should never leak upstream.

---

## Step 2: Install Keepalived

Run this on **both nodes**:

```bash
sudo apt install keepalived
sudo useradd -r -s /sbin/nologin keepalived_script
```

The dedicated `keepalived_script` user is used to run health-check scripts with reduced privileges, per keepalived's script-security model.

---

## Step 3: Configure Each Node

Each node runs **two VRRP instances** - one where it's the preferred master, and one where it's a pure backup. This is what creates the active-active effect: both VIPs are "live" somewhere on the network at all times, and each node is actively serving one of them.

{% <admonition kind="important"> %}
**Change the `auth_pass` value** on both configs mentioned below to a unique shared secret before deploying. You can generate one with `openssl rand -base64 6`.
{% </admonition> %}
### Node 1

`/etc/keepalived/keepalived.conf`

```bash
global_defs {
    router_id DNS1
    enable_script_security
    max_auto_priority
    script_user keepalived_script
}

# Health check: verify pihole-FTL is running AND DNS resolves
vrrp_script chk_dns {
    script "/bin/sh -c '/usr/bin/pgrep pihole-FTL > /dev/null && /usr/bin/dig -4 +short +tries=1 +timeout=2 dns-probe.internal @127.0.0.1 | grep -q .'"
    interval 5     # Run check every 5 seconds
    timeout 4      # Fail if check takes longer than 4 seconds
    weight  -20    # Subtract 20 from priority on failure
    fall    2      # Require 2 consecutive failures before marking DOWN
    rise    2      # Require 2 consecutive successes before marking UP
}

# VIP1 - preferred owner, reclaims after 60s on recovery
vrrp_instance DNS_VIP1 {
    state               BACKUP        # Must be BACKUP for preempt_delay to work
    interface           eth0
    virtual_router_id   51
    priority            100           # Higher priority = wins master election
    advert_int          1
    preempt_delay       60            # Wait 60s after boot before asserting MASTER

    unicast_src_ip  192.168.0.10
    unicast_peer {
        192.168.0.11                  # Send VRRP packets directly (avoids multicast issues)
    }

    authentication {
        auth_type PASS
        auth_pass CHANGE_ME
    }

    virtual_ipaddress {
        192.168.0.12/24
    }

    track_script {
        chk_dns
    }
}

# VIP2 - true backup, never preempts the other node
vrrp_instance DNS_VIP2 {
    state               BACKUP
    interface           eth0
    virtual_router_id   52
    priority            90
    advert_int          1
    nopreempt                         # Never reclaim - the peer is the preferred owner of VIP2

    unicast_src_ip  192.168.0.10
    unicast_peer {
        192.168.0.11
    }

    authentication {
        auth_type PASS
        auth_pass CHANGE_ME
    }

    virtual_ipaddress {
        192.168.0.13/24
    }

    track_script {
        chk_dns
    }
}
```

### Node 2

`/etc/keepalived/keepalived.conf`

Node 2's config is a mirror image: it's the preferred owner of VIP2 and the backup for VIP1.

```bash
global_defs {
    router_id DNS2
    enable_script_security
    max_auto_priority
    script_user keepalived_script
}

vrrp_script chk_dns {
    script "/bin/sh -c '/usr/bin/pgrep pihole-FTL > /dev/null && /usr/bin/dig -4 +short +tries=1 +timeout=2 dns-probe.internal @127.0.0.1 | grep -q .'"
    interval 5
    timeout 4
    weight  -20
    fall    2
    rise    2
}

# VIP1 - true backup, never preempts Node 1
vrrp_instance DNS_VIP1 {
    state               BACKUP
    interface           eth0
    virtual_router_id   51
    priority            90
    advert_int          1
    nopreempt

    unicast_src_ip  192.168.0.11
    unicast_peer {
        192.168.0.10
    }

    authentication {
        auth_type PASS
        auth_pass CHANGE_ME
    }

    virtual_ipaddress {
        192.168.0.12/24
    }

    track_script {
        chk_dns
    }
}

# VIP2 - preferred owner, reclaims after 60s on recovery
vrrp_instance DNS_VIP2 {
    state               BACKUP
    interface           eth0
    virtual_router_id   52
    priority            100
    advert_int          1
    preempt_delay       60

    unicast_src_ip  192.168.0.11
    unicast_peer {
        192.168.0.10
    }

    authentication {
        auth_type PASS
        auth_pass CHANGE_ME
    }

    virtual_ipaddress {
        192.168.0.13/24
    }

    track_script {
        chk_dns
    }
}
```

### A few design notes worth calling out

- **`state BACKUP` on both instances, on both nodes** - this looks counterintuitive, but it's required for `preempt_delay` to work correctly. Priority determines who actually wins the election.
- **`nopreempt` vs `preempt_delay`** - these are mutually exclusive per instance. The preferred-owner instance uses `preempt_delay` so it reclaims its VIP automatically after recovering (with a grace period to avoid flapping). The backup instance uses `nopreempt` so it never snatches the VIP away from a healthy peer.
- **Unicast, not multicast** - `unicast_src_ip` / `unicast_peer` sends VRRP advertisements directly between the two nodes rather than relying on multicast, which can be unreliable on consumer routers/switches with IGMP snooping enabled.


---

## Step 4: Enable and Start

Run on **both nodes**:

```bash
sudo systemctl enable keepalived.service
sudo systemctl start keepalived.service
sudo reboot
```

---

## Step 5: Verify It's Working

**Check the service:**

```bash
sudo systemctl status keepalived.service
```

**Confirm each node holds its expected VIP:**

```bash
ip addr show eth0
```

Node 1 should show `192.168.0.12/24`; Node 2 should show `192.168.0.13/24`.

**Watch keepalived's logs live:**

```bash
sudo journalctl -u keepalived -f
```

### Test an actual failover

1. Power off Node 1: `sudo poweroff` (or `sudo shutdown -h now`, depending on your device type)
2. On Node 2, check its interface again - it should now hold **both** VIPs:
   ```bash
   ip addr show eth0
   # Should show both 192.168.0.12 and 192.168.0.13
   ```
3. Power Node 1 back on. Because the backup instance uses `nopreempt`, Node 2 keeps serving both VIPs until its own health check fails - there's no disruptive automatic handback. Node 1 simply rejoins as a healthy backup.

If both checks pass, you have a working active-active Pi-hole cluster: DNS keeps resolving for your whole network even if one node is powered off, rebooting, or being reimaged.

---

## Wrapping Up

With this setup, your router never talks to a single point of failure - it talks to two VIPs that are always being served by a healthy node. The health-check script goes a step further than just "is the process alive," actually confirming DNS resolution end-to-end before considering a node healthy. Combine this with keeping both nodes' Pi-hole configuration in sync (via Teleporter export/import) and you've got a resilient, low-maintenance DNS layer for your home network.

Flush!


