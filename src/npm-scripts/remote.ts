import '../bootstrap.js';
import { MCPDevice, getRemoteDeviceConfigPath } from '../remote-device/device.js';
import fs from 'fs/promises';
import os from 'os';
import { captureRemote } from '../utils/capture.js';

const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function printRemoteHeader() {
    console.log();
    console.log(`${BLUE}██████╗ ███████╗███████╗██╗  ██╗████████╗ ██████╗ ██████╗     ██████╗ ██████╗ ███╗   ███╗███╗   ███╗ █████╗ ███╗   ██╗██████╗ ███████╗██████╗${RESET}`);
    console.log(`${BLUE}██╔══██╗██╔════╝██╔════╝██║ ██╔╝╚══██╔══╝██╔═══██╗██╔══██╗   ██╔════╝██╔═══██╗████╗ ████║████╗ ████║██╔══██╗████╗  ██║██╔══██╗██╔════╝██╔══██╗${RESET}`);
    console.log(`${BLUE}██║  ██║█████╗  ███████╗█████╔╝    ██║   ██║   ██║██████╔╝   ██║     ██║   ██║██╔████╔██║██╔████╔██║███████║██╔██╗ ██║██║  ██║█████╗  ██████╔╝${RESET}`);
    console.log(`${BLUE}██║  ██║██╔══╝  ╚════██║██╔═██╗    ██║   ██║   ██║██╔═══╝    ██║     ██║   ██║██║╚██╔╝██║██║╚██╔╝██║██╔══██║██║╚██╗██║██║  ██║██╔══╝  ██╔══██╗${RESET}`);
    console.log(`${BLUE}██████╔╝███████╗███████║██║  ██╗   ██║   ╚██████╔╝██║        ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║ ╚═╝ ██║██║  ██║██║ ╚████║██████╔╝███████╗██║  ██║${RESET}`);
    console.log(`${BLUE}╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝         ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═╝  ╚═╝${RESET}`);
    console.log();
    console.log(`${BLUE}🌐 Remote Connection${RESET}`);
    console.log();
}

export async function runRemote() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log(`Desktop Commander Remote MCP device

Usage:
  desktop-commander remote [options]

Options:
  --logout              Remove saved local Remote MCP credentials and exit
  --no-persist-session  Do not reuse or save authentication for this run
  --disable-no-sleep    Do not prevent sleep while the remote device is running
  --debug                Enable verbose debug logging
  -h, --help             Show this help

Examples:
  npx @wonderwhy-er/desktop-commander@latest remote
  npx @wonderwhy-er/desktop-commander@latest remote --debug
  npx @wonderwhy-er/desktop-commander@latest remote --logout

Note:
  --logout removes local credentials only. Revoke the device in the Remote MCP
  dashboard if you also want to invalidate its server-side authorization.`);
        return;
    }
    if (process.argv.includes('--logout')) {
        const configPath = getRemoteDeviceConfigPath();
        try {
            await fs.rm(configPath, { force: true });
            console.log('🔓 Logged out locally. Saved Remote MCP device credentials were removed.');
            console.log(`   ${configPath}`);
        } catch (error: any) {
            console.error('❌ Failed to remove saved Remote MCP credentials:', error.message);
            process.exitCode = 1;
        }
        return;
    }
    printRemoteHeader();

    if (!process.env.DESKTOP_COMMANDER_WAIT_CAP_MS) {
        process.env.DESKTOP_COMMANDER_WAIT_CAP_MS = '2000';
    }

    // --persist-session is kept as an accepted no-op so existing invocations
    // and docs keep working; --no-persist-session opts back out.
    const persistSession = !process.argv.includes('--no-persist-session');
    if (!persistSession) {
        console.log('🔓 Session persistence disabled — re-authorization required on every start');
    }
    const disableNoSleep = process.argv.includes('--disable-no-sleep');
    const verbose = process.argv.includes('--debug');
    console.debug('[DEBUG] Verbose mode: ', verbose);
    // Override console.debug based on verbose flag
    // When --debug is not provided, console.debug becomes a no-op
    if (!verbose) {
        console.debug = () => { };
    }

    console.debug('[DEBUG] Platform:', os.platform());
    await captureRemote('remote_device_command_started', {
        node_version: process.version,
        persist_session: persistSession,
    });

    // Prevent unhandled rejections or transient network glitches from crashing remote mode
    process.on('uncaughtException', (err) => {
        console.error('⚠️ Uncaught exception in remote process:', err instanceof Error ? err.message : err);
        captureRemote('remote_uncaught_exception', { error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    });
    process.on('unhandledRejection', (reason) => {
        console.error('⚠️ Unhandled rejection in remote process:', reason instanceof Error ? reason.message : reason);
        captureRemote('remote_unhandled_rejection', { error: reason instanceof Error ? reason.message : String(reason) }).catch(() => {});
    });

    // Start sleep prevention on Windows or macOS (unless disabled)
    if (!disableNoSleep) {
        if (os.platform() === 'win32') {
            if (process.env.DESKTOP_COMMANDER_NO_SLEEP_MANAGED === '1') {
                console.log('⚡ Windows no-sleep mode active (managed by parent daemon supervisor)');
            } else {
                try {
                    const { spawn } = await import('child_process');
                    const parentPid = process.pid;
                    const keepAliveScript = `
$c = @"
using System;
using System.Runtime.InteropServices;
public class Win32PowerKeepAlive {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
    public static uint KeepAlive() { return SetThreadExecutionState(0x80000041); }
    public static uint ResetState() { return SetThreadExecutionState(0x80000000); }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'Win32PowerKeepAlive').Type) {
    Add-Type -TypeDefinition $c -Language CSharp
}
[Win32PowerKeepAlive]::KeepAlive() | Out-Null
$parentPid = ${parentPid}
while ($true) {
    Start-Sleep -Seconds 60
    if ($parentPid -and -not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) {
        [Win32PowerKeepAlive]::ResetState() | Out-Null
        exit 0
    }
    [Win32PowerKeepAlive]::KeepAlive() | Out-Null
}
`;
                    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', keepAliveScript], {
                        detached: false,
                        stdio: 'ignore',
                        windowsHide: true,
                    });
                    const cleanup = () => {
                        try { ps.kill(); } catch {}
                    };
                    process.once('exit', cleanup);
                    process.once('SIGINT', cleanup);
                    process.once('SIGTERM', cleanup);
                    console.log('⚡ Windows no-sleep mode enabled (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)');
                } catch (error) {
                    console.warn('⚠️ Failed to start Windows no-sleep:', error);
                }
            }
        } else if (os.platform() === 'darwin') {
            try {
                console.debug('[DEBUG] Start caffeinate', process.pid);
                const { default: caffeinate } = await import('caffeinate');
                caffeinate({ pid: process.pid });
                console.log('☕ No sleep mode enabled');
            } catch (error) {
                console.warn('⚠️ Failed to start caffeinate:', error);
            }
        }
    }

    const device = new MCPDevice({ persistSession });
    await device.start();
}
