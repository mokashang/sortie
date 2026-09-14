// Outer half of the "run a console program with no window" launcher used by the "Sortie Caddy" task
// (setup.ps1 step 4). Task Scheduler opens a console window for every console-subsystem action it starts
// in the interactive session - that was the blank "caddy.exe" window on the desktop, and closing it killed
// the proxy (LastTaskResult 0xC000013A, 2026-09-14). wscript.exe is a GUI-subsystem host, so a task whose
// action is wscript.exe shows nothing, and WshShell.Run(..., 0, true) starts its child with SW_HIDE.
//
// Usage (the scheduled-task action):
//   wscript.exe //B //Nologo "<repo>\ops\windows\run-hidden.js" [-Retries N] [-RetryDelaySec S] <exe> [args...]
//
// Two layers on purpose: Stop-ScheduledTask ends only the task's own process (this wscript.exe), not its
// children (verified 2026-09-14). So this script does not start the program itself; it hands everything to
// run-hidden.ps1 (hidden, waited on), which starts the program, kills it the moment this wscript.exe
// disappears, restarts it up to N times when it exits non-zero (Task Scheduler's own restart-on-failure
// never fires for an exit code), and returns the program's exit code through both layers.
// The working directory is inherited from the task.
// JScript, not VBScript: VBScript is a deprecated feature-on-demand since Windows 11 24H2; WSH and JScript are not.
function quote(a) {
  return /[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a;
}
var args = WScript.Arguments;
if (args.length < 1) {
  WScript.Echo("usage: run-hidden.js <exe> [args...]");
  WScript.Quit(2);
}
var fso = new ActiveXObject("Scripting.FileSystemObject");
var inner = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "run-hidden.ps1");
var parts = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", quote(inner)];
for (var i = 0; i < args.length; i++) parts.push(quote(args.Item(i)));
var shell = new ActiveXObject("WScript.Shell");
WScript.Quit(shell.Run(parts.join(" "), 0, true));
