"""确保 DSH-Space 的 VNC 链路可用：x11vnc + websockify（在 VM 内跑）。

SSH 密码读取顺序：DSH_COMPANION_SSH_PASS > 同目录 .ssh-password > 旧默认值。
"""
import json
import os
import subprocess
import sys


def _read_ssh_pass():
    env = os.environ.get("DSH_COMPANION_SSH_PASS")
    if env:
        return env
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, ".ssh-password"), "r", encoding="utf-8") as f:
            value = f.read().strip()
        if value:
            return value
    except Exception:
        pass
    return "DshSpace2026"


HOST, PORT, USER = "127.0.0.1", 2222, "dsh"
PASS = _read_ssh_pass()


def result(**kw):
    print(json.dumps(kw, ensure_ascii=False))
    return 0


def main():
    ensure = "ensure" in sys.argv
    try:
        import paramiko
    except Exception as e:
        return result(ok=False, error="paramiko missing: %s" % e)
    try:
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        c.connect(HOST, port=PORT, username=USER, password=PASS, timeout=8, banner_timeout=8, auth_timeout=8)
    except Exception as e:
        return result(ok=False, ssh=False, error="ssh failed: %s" % e)

    def run(cmd, timeout=15):
        _i, o, _e = c.exec_command(cmd, timeout=timeout, get_pty=True)
        return o.read().decode("utf-8", "replace")

    try:
        status = {}
        xvnc = run("pgrep -f '[x]11vnc' || true").strip()
        ws = run("pgrep -f '[w]ebsockify' || true").strip()
        status["x11vnc"] = bool(xvnc)
        status["websockify"] = bool(ws)
        listener = run("ss -lnt 2>/dev/null | grep -c ':6080 ' || true").strip()
        status["listening_6080"] = listener not in ("", "0")
        started = []
        if ensure:
            if not status["x11vnc"]:
                run("nohup x11vnc -display :0 -forever -shared -localhost -rfbport 5900 -noxdamage >/tmp/x11vnc.log 2>&1 &", 10)
                started.append("x11vnc")
            if not status["websockify"]:
                run("nohup /usr/bin/python3 /usr/bin/websockify --web=/usr/share/novnc 0.0.0.0:6080 localhost:5900 >/tmp/websockify.log 2>&1 &", 10)
                started.append("websockify")
            import time
            for _ in range(20):
                if run("ss -lnt 2>/dev/null | grep -c ':6080 ' || true").strip() not in ("", "0"):
                    break
                time.sleep(0.5)
            status["x11vnc"] = bool(run("pgrep -f '[x]11vnc' || true").strip())
            status["websockify"] = bool(run("pgrep -f '[w]ebsockify' || true").strip())
            status["listening_6080"] = run("ss -lnt 2>/dev/null | grep -c ':6080 ' || true").strip() not in ("", "0")
        status.update(ok=True, started=started, vm=True)
        return result(**status)
    finally:
        try:
            c.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
