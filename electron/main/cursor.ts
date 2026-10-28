import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

class MouseMonitor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private clickSequence = 0;
  private zoomSteps = 0;
  private desiredActive = false;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  get click() { this.activate(); return this.clickSequence; }
  get zoom() { this.activate(); return this.zoomSteps; }
  activate() { this.desiredActive = true; this.start(); }
  private scheduleRetry(token: number) {
    if (!this.desiredActive || token !== this.generation || this.retryTimer || this.retryAttempt >= 3) return;
    const delay = [150, 350, 700][this.retryAttempt++] ?? 700;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.desiredActive && token === this.generation) this.start();
    }, delay);
  }
  private start() {
    if (this.child || !this.desiredActive || process.platform !== 'win32') return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const token = ++this.generation;
    const script = `$code=@'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class LRMouse {
  private const int WH_MOUSE_LL = 14, WM_LBUTTONDOWN = 0x0201, WM_MOUSEWHEEL = 0x020A, VK_CONTROL = 0x11;
  private delegate IntPtr MouseProc(int nCode, IntPtr wParam, IntPtr lParam);
  private static readonly MouseProc Proc = Hook;
  private static IntPtr Handle = IntPtr.Zero;
  [StructLayout(LayoutKind.Sequential)] private struct Point { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] private struct MouseData { public Point Pt; public uint Data; public uint Flags; public uint Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr Hwnd; public uint Value; public IntPtr WParam; public IntPtr LParam; public uint Time; public Point Pt; }
  [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SetWindowsHookEx(int id, MouseProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll", SetLastError=true)] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] private static extern int GetMessage(out Message msg, IntPtr win, uint min, uint max);
  [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message msg);
  [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message msg);
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)] private static extern IntPtr GetModuleHandle(string name);
  private static IntPtr Hook(int code, IntPtr message, IntPtr data) {
    if (code >= 0) {
      long kind = message.ToInt64();
      if (kind == WM_LBUTTONDOWN) Emit("click");
      else if (kind == WM_MOUSEWHEEL && (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0) {
        MouseData value = Marshal.PtrToStructure<MouseData>(data);
        short delta = unchecked((short)(value.Data >> 16));
        Emit(delta > 0 ? "zoom-in" : "zoom-out");
        return new IntPtr(1);
      }
    }
    return CallNextHookEx(Handle, code, message, data);
  }
  private static void Emit(string value) { Console.Out.WriteLine(value); Console.Out.Flush(); }
  public static int Run() {
    using (Process process = Process.GetCurrentProcess()) using (ProcessModule module = process.MainModule) Handle = SetWindowsHookEx(WH_MOUSE_LL, Proc, GetModuleHandle(module.ModuleName), 0);
    if (Handle == IntPtr.Zero) return Marshal.GetLastWin32Error();
    Emit("ready");
    Message msg; while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
    UnhookWindowsHookEx(Handle); return 0;
  }
}
'@; Add-Type -TypeDefinition $code; exit [LRMouse]::Run()`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    try {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const child = spawn(`${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      let pending = '';
      child.stdout.on('data', chunk => {
        pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
        for (const line of lines) {
          const event = line.trim();
          if (event === 'ready') this.retryAttempt = 0;
          if (event === 'click') this.clickSequence++;
          if (event === 'zoom-in') this.zoomSteps++;
          if (event === 'zoom-out') this.zoomSteps--;
        }
      });
      child.stderr.on('data', chunk => console.error('Mouse monitor:', chunk.toString()));
      let settled = false;
      const finish = (code?: number | null) => {
        if (settled) return;
        settled = true;
        if (this.child === child) this.child = null;
        if (code && code !== 1) console.error('Mouse monitor exited:', code);
        this.scheduleRetry(token);
      };
      child.on('error', () => finish());
      child.on('exit', code => finish(code));
    } catch {
      this.child = null;
      this.scheduleRetry(token);
    }
  }
  stop() {
    this.desiredActive = false;
    this.generation++;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const child = this.child;
    this.child = null;
    this.retryAttempt = 0;
    child?.kill();
  }
}
export const clickMonitor = new MouseMonitor();
