"""Control the AI's own Linux screen (VirtualBox VM) over SSH.

Usage:
  python space_ctl.py shot  <host_png_path>
  python space_ctl.py click <x> <y> [button]
  python space_ctl.py move  <x> <y>
  python space_ctl.py dclick <x> <y>
  python space_ctl.py drag  <x1> <y1> <x2> <y2>
  python space_ctl.py type  <text>
  python space_ctl.py key   <xdotool-key-combo>
  python space_ctl.py run   <shell command>
  python space_ctl.py res
"""
import sys, base64
import io
import paramiko

HOST, PORT, USER, PASS = "127.0.0.1", 2222, "dsh", "DshSpace2026"
ENV = "export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority; "


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, password=PASS,
              timeout=30, banner_timeout=30, auth_timeout=30)
    return c


def run(conn, cmd, timeout=120):
    stdin, stdout, stderr = conn.exec_command(cmd, timeout=timeout, get_pty=True)
    out = b""
    while True:
        d = stdout.channel.recv(4096)
        if not d:
            break
        out += d
    rc = stdout.channel.recv_exit_status()
    return rc, out.decode("utf-8", "replace")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    mode = sys.argv[1]
    args = sys.argv[2:]
    win = ""
    for a in list(args):
        if a.startswith("--win="):
            win = a[6:]
            args.remove(a)
    c = connect()
    try:
        if win:
            import shlex
            ENV2 = ENV + "wid=$(xdotool search --name -- " + shlex.quote(win) + " 2>/dev/null | tail -1); [ -n \"$wid\" ] && { xdotool windowactivate --sync $wid 2>/dev/null || xdotool windowfocus $wid 2>/dev/null; sleep 0.25; }; "
        else:
            ENV2 = ENV
        if mode == "shot":
            local = args[0]
            import time as _time
            remote = "/tmp/_ai_shot_%d.png" % int(_time.time() * 1000)
            run(c, ENV2 + "scrot %s" % remote)
            sftp = c.open_sftp()
            sftp.get(remote, local)
            print("shot ->", local)
        elif mode == "click":
            x, y = int(args[0]), int(args[1])
            button = args[2] if len(args) > 2 else "1"
            rc, out = run(c, ENV2 + "xdotool mousemove --sync %d %d click %s" % (x, y, button))
            print("click", x, y, "rc=", rc)
        elif mode == "move":
            rc, out = run(c, ENV2 + "xdotool mousemove --sync %d %d" % (int(args[0]), int(args[1])))
            print("move rc=", rc)
        elif mode == "dclick":
            rc, out = run(c, ENV2 + "xdotool mousemove --sync %d %d click --repeat 2 --delay 120 1" % (int(args[0]), int(args[1])))
            print("dclick rc=", rc)
        elif mode == "drag":
            x1, y1, x2, y2 = (int(v) for v in args[:4])
            rc, out = run(c, ENV2 + "xdotool mousemove --sync %d %d mousedown 1 sleep 0.2 mousemove --sync --sync %d %d sleep 0.2 mouseup 1" % (x1, y1, x2, y2))
            print("drag rc=", rc)
        elif mode == "type":
            text_file_local = ""
            for a in list(args):
                if a.startswith("--text-file="):
                    text_file_local = a[len("--text-file="):]
                    args.remove(a)
            if text_file_local:
                with io.open(text_file_local, "r", encoding="utf-8") as f:
                    text = f.read()
                win2 = win
                win = win2
            else:
                text = " ".join(args)
            # 可靠打字：文本/窗口名写成远程文件（避免 shell 转义），
            # 激活目标窗口 -> 按窗口类型选粘贴键（xterm: Shift+Insert，终端: Ctrl+Shift+V，其它: Ctrl+V）。
            import time as _time
            stamp = int(_time.time() * 1000)
            text_file = "/tmp/_ai_type_%d.txt" % stamp
            win_file = "/tmp/_ai_win_%d.txt" % stamp
            script_file = "/tmp/_ai_type_%d.sh" % stamp
            sftp = c.open_sftp()
            try:
                with sftp.open(text_file, "wb") as f:
                    f.write(text.encode("utf-8"))
                with sftp.open(win_file, "wb") as f:
                    f.write((win or "").encode("utf-8"))
                script = """#!/bin/bash
export DISPLAY=:0
export XAUTHORITY=$HOME/.Xauthority
TARGET=$(xdotool search --name -- "$(cat %s)" 2>/dev/null | tail -1)
if [ -n "$TARGET" ]; then
  xdotool windowactivate --sync "$TARGET" 2>/dev/null || xdotool windowfocus "$TARGET" 2>/dev/null
  sleep 0.25
fi
WID=$(xdotool getactivewindow 2>/dev/null || echo "$TARGET")
CLS=$(xprop -id "$WID" WM_CLASS 2>/dev/null | tr 'A-Z' 'a-z')
case "$CLS" in
  *xterm*) PK=shift+Insert ;;
  *terminal*|*konsole*|*tilix*|*guake*|*xfce4*) PK=ctrl+shift+v ;;
  *) PK=ctrl+v ;;
esac
if command -v xclip >/dev/null 2>&1; then
  xclip -selection clipboard -i < %s
  xclip -selection primary -i < %s 2>/dev/null || true
  sleep 0.15
  xdotool key --clearmodifiers "$PK"
  echo "paste=$PK cls=$CLS active=$WID"
else
  xdotool type --clearmodifiers --delay 60 --file %s
  echo "fallback-xdotool active=$WID"
fi
""" % (win_file, text_file, text_file, text_file)
                with sftp.open(script_file, "wb") as f:
                    f.write(script.encode("utf-8"))
            finally:
                sftp.close()
            rc, out = run(c, "bash " + script_file)
            out = out.strip()
            if out:
                print(out[-300:])
            print("type rc=", rc)
        elif mode == "key":
            combo = args[0] if args else "Return"
            rc, out = run(c, ENV2 + "xdotool key --clearmodifiers %s" % combo)
            print("key", combo, "rc=", rc)
        elif mode == "run":
            cmd = " ".join(args)
            rc, out = run(c, ENV2 + cmd)
            sys.stdout.write(out)
            print("rc=", rc)
        elif mode == "res":
            rc, out = run(c, ENV2 + "xdotool getdisplaygeometry")
            print(out.strip())
        else:
            print(__doc__)
    finally:
        c.close()


if __name__ == "__main__":
    main()
