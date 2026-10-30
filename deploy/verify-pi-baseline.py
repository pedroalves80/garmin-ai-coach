#!/usr/bin/env python3
"""Verify original services/configuration; never change anything to make checks pass."""
import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[2] if len(sys.argv) < 2 else pathlib.Path(sys.argv[1])
state = root / "data/garmin-ai-coach-deploy-state/baseline.json"
baseline = json.loads(state.read_text())
original = baseline["containers"]
current = json.loads(subprocess.check_output(["docker", "inspect", *[c["id"] for c in original]], text=True))
changed = []
for old, container in zip(original, current):
    if (container["Id"] != old["id"] or container["State"]["StartedAt"] != old["started"]
            or container["RestartCount"] != old["restarts"] or container["State"]["Status"] != "running"
            or (old["health"] == "healthy" and container["State"].get("Health", {}).get("Status") != "healthy")):
        changed.append(old["name"])
config_changes = []
for name, expected in baseline["hashes"].items():
    path = root / name
    try:
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
    except PermissionError:
        actual = subprocess.check_output(["sudo", "-n", "sha256sum", str(path)], text=True).split()[0]
    if actual != expected:
        config_changes.append(name)
print(json.dumps({"originalContainers": len(original), "restartedStoppedReplacedOrUnhealthy": changed,
                  "sharedConfigurationChanges": config_changes}, indent=2))
if changed or config_changes:
    sys.exit(1)
