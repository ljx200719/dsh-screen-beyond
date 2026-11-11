"""Control the AI's own Android phone.

Two possible backends:
  1) Waydroid (Android container) running inside the DSH-Space Linux VM  -> preferred
  2) Android emulator on the host (adb emulator-5554)                   -> legacy fallback

Usage:
  python phone_ctl.py shot  <host_png_path>
  python phone_ctl.py tap   <x> <y>
  python phone_ctl.py swipe <x1> <y1> <x2> <y2> [ms]
  python phone_ctl.py text  <text>
  python phone_ctl.py key   <KEYCODE_NAME>
  python phone_ctl.py info
  python phone_ctl.py shell <命令>   (仅代码控制权限下使用)
"""
import base64
import shlex
import subprocess
import sys

import os as _os
ADB = _os.environ.get("DSH_COMPANION_ADB") or r"D:\dsh-env\android-sdk\platform-tools\adb.exe"
if not _os.path.exists(ADB):
    ADB = "adb"
SSH_HOST, SSH_PORT, SSH_USER, SSH_PASS = "127.0.0.1", 2222, "dsh", "DshSpace2026"
LXC = "sudo lxc-attach -P /var/lib/waydroid/lxc -n waydroid -- "


def adb(*args, binary=False):
    cmd = [ADB] + list(args)
    p = subprocess.run(cmd, capture_output=True)
    if binary:
        return p.stdout
    return p.stdout.decode("utf-8", "replace") + p.stderr.decode("utf-8", "replace")


def adb_device_present():
    try:
        out = adb("devices")
        return "emulator-5554\tdevice" in out
    except Exception:
        return False


ADB_IME = "com.android.adbkeyboard/.AdbIME"


def ensure_adb_keyboard():
    """开启 ADBKeyboard；返回需要恢复的旧输入法（失败返回 None）。"""
    try:
        old = adb("shell", "settings", "get", "secure", "default_input_method").strip()
        adb("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1")
        adb("shell", "ime", "enable", ADB_IME)
        adb("shell", "ime", "set", ADB_IME)
        return old if old and "adbkeyboard" not in old else None
    except Exception:
        return None


def _first_other_ime():
    try:
        for line in adb("shell", "ime", "list", "-s").splitlines():
            line = line.strip()
            if line and "adbkeyboard" not in line:
                return line
    except Exception:
        pass
    return "com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME"


def restore_ime(old):
    target = old if (old and "adbkeyboard" not in old) else _first_other_ime()
    try:
        adb("shell", "ime", "set", target)
    except Exception:
        pass


def input_text_unicode(text):
    """中文/非 ASCII：走 ADBKeyboard 广播（ADB_INPUT_B64）。"""
    import base64 as _b64
    old = ensure_adb_keyboard()
    if old is None and "adbkeyboard" not in adb("shell", "settings", "get", "secure", "default_input_method"):
        return False
    import time as _time
    _time.sleep(0.5)
    payload = _b64.b64encode(text.encode("utf-8")).decode("ascii")
    adb("shell", "am", "broadcast", "-a", "ADB_INPUT_B64", "--es", "msg", payload)
    _time.sleep(0.4)
    restore_ime(old)
    return True


def ssh_connect():
    import paramiko
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(SSH_HOST, port=SSH_PORT, username=SSH_USER, password=SSH_PASS,
              timeout=20, banner_timeout=20, auth_timeout=20)
    return c


def vm_exec(conn, cmd, timeout=90):
    stdin, stdout, stderr = conn.exec_command(cmd, timeout=timeout, get_pty=True)
    return stdout.read().decode("utf-8", "replace")


def waydroid_state(conn):
    try:
        out = vm_exec(conn, "waydroid status 2>&1 | head -4", 30)
    except Exception:
        return ""
    return out


def waydroid_running(conn):
    out = waydroid_state(conn)
    return "Session:" in out and "RUNNING" in out


def lxc(conn, android_cmd, timeout=90):
    return vm_exec(conn, LXC + android_cmd, timeout)


def wake(conn):
    try:
        lxc(conn, "input keyevent KEYCODE_WAKEUP", 20)
    except Exception:
        pass


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    mode = sys.argv[1]

    use_adb = adb_device_present()

    if use_adb:
        # legacy host emulator backend
        if mode == "shot":
            local = sys.argv[2]
            adb("shell", "screencap", "-p", "/sdcard/_ai_shot.png")
            adb("pull", "/sdcard/_ai_shot.png", local)
            print("shot ->", local)
        elif mode == "tap":
            print(adb("shell", "input", "tap", sys.argv[2], sys.argv[3]).strip())
        elif mode == "swipe":
            x1, y1, x2, y2 = sys.argv[2:6]
            ms = sys.argv[6] if len(sys.argv) > 6 else "250"
            print(adb("shell", "input", "swipe", x1, y1, x2, y2, ms).strip())
        elif mode == "text":
            tf = ""
            parts = []
            for a in sys.argv[2:]:
                if a.startswith("--text-file="):
                    tf = a[len("--text-file="):]
                else:
                    parts.append(a)
            if tf:
                import io as _io
                with _io.open(tf, "r", encoding="utf-8") as f:
                    text = f.read().strip()
            else:
                text = " ".join(parts)
            if any(ord(ch) > 127 for ch in text):
                ok = input_text_unicode(text)
                print("unicode text sent" if ok else "unicode input failed (ADBKeyboard missing?)")
            else:
                print(adb("shell", "input", "text", text.replace(" ", "%s")).strip())
        elif mode == "key":
            print(adb("shell", "input", "keyevent", sys.argv[2]).strip())
        elif mode == "shell":
            cmd = " ".join(sys.argv[2:])
            print(adb("shell", cmd))
        elif mode == "info":
            print("devices:\n" + adb("devices"))
            print("size:", adb("shell", "wm", "size").strip())
            print("model:", adb("shell", "getprop", "ro.product.model").strip())
            print("android:", adb("shell", "getprop", "ro.build.version.release").strip())
        else:
            print(__doc__)
        return

    # Waydroid inside the Debian VM
    conn = None
    try:
        conn = ssh_connect()
        if not waydroid_running(conn):
            print("专属手机没开：VM 里的 Waydroid 没有运行（或 VM 本身没启动）。")
            print(waydroid_state(conn))
            return

        if mode == "shot":
            local = sys.argv[2]
            wake(conn)
            lxc(conn, "/system/bin/screencap -p /data/local/tmp/_ai_shot.png", 120)
            b64 = lxc(conn, "base64 /data/local/tmp/_ai_shot.png", 120)
            raw = "".join(b64.split())
            if not raw:
                print("截图失败：Waydroid 返回空图")
                return
            with open(local, "wb") as f:
                f.write(base64.b64decode(raw))
            print("shot ->", local)
        elif mode == "tap":
            wake(conn)
            print(lxc(conn, "input tap %s %s" % (sys.argv[2], sys.argv[3]), 60).strip() or "tap ok")
        elif mode == "swipe":
            x1, y1, x2, y2 = sys.argv[2:6]
            ms = sys.argv[6] if len(sys.argv) > 6 else "300"
            wake(conn)
            print(lxc(conn, "input swipe %s %s %s %s %s" % (x1, y1, x2, y2, ms), 60).strip() or "swipe ok")
        elif mode == "text":
            text = " ".join(sys.argv[2:])
            if any(ord(ch) > 127 for ch in text):
                print("注意：Waydroid 的 input text 只支持 ASCII；中文请改用其它方式。")
            q = shlex.quote(text)
            print(lxc(conn, "input text " + q, 60).strip() or "text ok")
        elif mode == "key":
            print(lxc(conn, "input keyevent " + shlex.quote(sys.argv[2]), 60).strip() or "key ok")
        elif mode == "shell":
            cmd = " ".join(sys.argv[2:])
            print(lxc(conn, "sh -c '%s'" % cmd.replace("'", "'\\''"), 120))
        elif mode == "info":
            print(waydroid_state(conn))
            print("size:", lxc(conn, "wm size", 30).strip())
            print("model:", lxc(conn, "getprop ro.product.model", 30).strip())
            print("android:", lxc(conn, "getprop ro.build.version.release", 30).strip())
        else:
            print(__doc__)
    except Exception as e:
        print("专属手机操作失败：%s" % str(e)[:300])
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
