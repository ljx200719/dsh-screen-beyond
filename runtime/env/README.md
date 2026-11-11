# env 目录（完整版辅助脚本）

这些脚本用于「完整版」：让插件能操作宿主机的 VirtualBox 虚拟机和安卓模拟器。

- 默认会使用 `D:\dsh-env`（如果存在）；不存在时使用本目录。
- 可以用环境变量覆盖：
  - `DSH_COMPANION_ENV`：辅助脚本目录
  - `DSH_COMPANION_PY`：Python 解释器（需要 paramiko）
  - `DSH_COMPANION_ADB`：adb.exe 路径
  - `DSH_COMPANION_ANDROID_SDK`：Android SDK 根目录
  - `DSH_COMPANION_EMULATOR`：emulator.exe 路径
  - `DSH_COMPANION_VBOX`：VBoxManage.exe 路径
- 里面的 `start_screen.ps1`、`space_ctl.py` 等与具体虚拟机名/SDK 路径有关，换机器时需要按实际环境修改。
- 设置 → 环境 → 「开始自检」可以检查缺什么。
