# RTK two-principal Shadow demo

Read **End-to-End App and Device Example** in Developer Docs before running.
Requires Python 3.10+, the pinned dependency, a TLS broker endpoint/CA, an activated
test device with `mqtt` and `iot_shadow`, and independently issued app/device token files.

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python demo.py device --token-file "$TUTORIAL_DIR/device-token.json"
# In a second terminal with the same venv and documented environment settings:
python demo.py app --token-file "$TUTORIAL_DIR/app-token.json" --power on
```

The device process simulates physical power starting at `off`; it does not operate
hardware or implement the separate device-owner transport/online protocol.
The app succeeds only after its update is accepted and a later GET shows convergence.
Both processes use exact topics, separate Client IDs, TLS verification and QoS 1.
This bounded tutorial exits on a disconnect and does not implement token renewal.
Keep credentials outside this directory. Do not run against a production device.

Dependency documentation: https://eclipse.dev/paho/files/paho.mqtt.python/html/client.html

For a bounded long-running simulated device, see **Credential Renewal and Connection Recovery** and run `python recover.py --duration 3600 --attempts 6` with its documented certificate and endpoint environment settings. This runner obtains real runtime credentials, supervises the simulator and removes its temporary token file on exit. It is not a firmware service manager.

See **Integration Test Kit** for `verify.py`: default read-only GET probes with independent token files; `--exercise` explicitly modifies the dedicated tutorial Shadow.
