"""SSH/SFTP helper for the AI space VM (host -> guest 127.0.0.1:2222)."""
import sys, time, paramiko

HOST, PORT, USER, PASS = "127.0.0.1", 2222, "dsh", "DshSpace2026"


def connect(retries=40, delay=5):
    last = None
    for i in range(retries):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            c.connect(HOST, port=PORT, username=USER, password=PASS,
                      timeout=120, banner_timeout=120, auth_timeout=120)
            return c
        except Exception as e:
            last = e
            print("connect retry %d: %s" % (i + 1, e), flush=True)
            time.sleep(delay)
    raise last


def run(cmd, timeout=3600):
    c = connect()
    try:
        stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout, get_pty=True)
        out = b""
        while True:
            d = stdout.channel.recv(4096)
            if not d:
                break
            out += d
            sys.stdout.write(d.decode("utf-8", "replace"))
            sys.stdout.flush()
        rc = stdout.channel.recv_exit_status()
        return rc
    finally:
        c.close()


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "run"
    if mode == "run":
        sys.exit(run(" ".join(sys.argv[2:])))
    if mode == "runfile":
        data = open(sys.argv[2], "rb").read().decode("utf-8")
        c = connect()
        try:
            sftp = c.open_sftp()
            with sftp.open("/tmp/provision.sh", "wb") as f:
                f.write(data.encode("utf-8"))
            sftp.chmod("/tmp/provision.sh", 0o755)
        finally:
            c.close()
        sys.exit(run("bash /tmp/provision.sh"))
    if mode == "get":
        c = connect()
        try:
            c.open_sftp().get(sys.argv[2], sys.argv[3])
        finally:
            c.close()
        print("downloaded", sys.argv[2])
        sys.exit(0)
    if mode == "put":
        c = connect()
        try:
            c.open_sftp().put(sys.argv[2], sys.argv[3])
        finally:
            c.close()
        print("uploaded", sys.argv[2])
        sys.exit(0)
    print("unknown mode", mode)
    sys.exit(2)
