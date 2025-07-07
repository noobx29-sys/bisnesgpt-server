# PM2 Log Capture Script for Windows
# This script captures PM2 logs and monitors for crashes/restarts

param(
    [string]$AppName = "server",
    [string]$LogsDir = ".\logs",
    [int]$MaxLogSize = 100MB,
    [switch]$Monitor = $false,
    [switch]$Help = $false
)

if ($Help) {
    Write-Host @"
PM2 Log Capture Script

Usage: .\capture-pm2-logs.ps1 [options]

Options:
  -AppName <name>     PM2 app name (default: server)
  -LogsDir <path>     Directory to store logs (default: .\logs)
  -MaxLogSize <size>  Maximum log file size before rotation (default: 100MB)
  -Monitor           Start continuous monitoring
  -Help              Show this help

Examples:
  .\capture-pm2-logs.ps1 -Monitor
  .\capture-pm2-logs.ps1 -AppName myapp -LogsDir C:\logs
  .\capture-pm2-logs.ps1 -MaxLogSize 50MB -Monitor
"@
    exit 0
}

# Create logs directory if it doesn't exist
if (!(Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
    Write-Host "Created logs directory: $LogsDir" -ForegroundColor Green
}

# Function to get timestamp
function Get-Timestamp {
    return Get-Date -Format "yyyy-MM-dd HH:mm:ss"
}

# Function to write log with timestamp
function Write-LogEntry {
    param([string]$Message, [string]$Type = "INFO", [string]$LogFile)
    
    $timestamp = Get-Timestamp
    $logEntry = "[$timestamp] [$Type] $Message"
    
    # Write to console
    switch ($Type) {
        "ERROR" { Write-Host $logEntry -ForegroundColor Red }
        "WARN"  { Write-Host $logEntry -ForegroundColor Yellow }
        "INFO"  { Write-Host $logEntry -ForegroundColor Green }
        default { Write-Host $logEntry }
    }
    
    # Write to file
    if ($LogFile) {
        Add-Content -Path $LogFile -Value $logEntry -Encoding UTF8
    }
}

# Function to check log file size and rotate if needed
function Test-LogRotation {
    param([string]$LogFile)
    
    if (Test-Path $LogFile) {
        $fileSize = (Get-Item $LogFile).Length
        if ($fileSize -gt $MaxLogSize) {
            $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
            $archiveFile = $LogFile -replace "\.log$", "-$timestamp.log"
            Move-Item $LogFile $archiveFile
            Write-LogEntry "Rotated log file: $archiveFile" "INFO" $LogFile
        }
    }
}

# Function to capture current PM2 status
function Get-PM2Status {
    try {
        $pm2Status = pm2 jlist | ConvertFrom-Json
        return $pm2Status
    } catch {
        Write-LogEntry "Failed to get PM2 status: $($_.Exception.Message)" "ERROR"
        return $null
    }
}

# Function to monitor PM2 app
function Start-PM2Monitor {
    $pm2LogFile = Join-Path $LogsDir "pm2-monitor.log"
    $crashLogFile = Join-Path $LogsDir "crash.log"
    
    Write-LogEntry "Starting PM2 monitoring for app: $AppName" "INFO" $pm2LogFile
    Write-LogEntry "Logs directory: $LogsDir" "INFO" $pm2LogFile
    Write-LogEntry "Max log size: $MaxLogSize" "INFO" $pm2LogFile
    
    $lastStatus = @{}
    $startTime = Get-Date
    
    while ($true) {
        try {
            # Check log rotation
            Test-LogRotation $pm2LogFile
            Test-LogRotation $crashLogFile
            
            # Get current PM2 status
            $currentStatus = Get-PM2Status
            
            if ($currentStatus) {
                $app = $currentStatus | Where-Object { $_.name -eq $AppName }
                
                if ($app) {
                    $pid = $app.pid
                    $status = $app.pm2_env.status
                    $restarts = $app.pm2_env.restart_time
                    $uptime = $app.pm2_env.pm_uptime
                    
                    # Check if app restarted
                    if ($lastStatus.ContainsKey($AppName)) {
                        $lastPid = $lastStatus[$AppName].pid
                        $lastRestarts = $lastStatus[$AppName].restarts
                        
                        if ($pid -ne $lastPid -or $restarts -gt $lastRestarts) {
                            $restartEntry = @"
========================================
APP RESTART DETECTED - $(Get-Timestamp)
========================================
App Name: $AppName
Previous PID: $lastPid
New PID: $pid
Previous Restarts: $lastRestarts
Current Restarts: $restarts
Status: $status
Uptime: $uptime
========================================

"@
                            Add-Content -Path $crashLogFile -Value $restartEntry -Encoding UTF8
                            Write-LogEntry "App restart detected - PID: $lastPid -> $pid, Restarts: $lastRestarts -> $restarts" "WARN" $pm2LogFile
                        }
                    }
                    
                    # Update last status
                    $lastStatus[$AppName] = @{
                        pid = $pid
                        status = $status
                        restarts = $restarts
                        uptime = $uptime
                    }
                    
                    # Log status every 5 minutes
                    $elapsed = (Get-Date) - $startTime
                    if ($elapsed.TotalMinutes -ge 5) {
                        Write-LogEntry "Status check - PID: $pid, Status: $status, Restarts: $restarts" "INFO" $pm2LogFile
                        $startTime = Get-Date
                    }
                } else {
                    Write-LogEntry "App '$AppName' not found in PM2 process list" "ERROR" $pm2LogFile
                }
            }
            
            # Capture PM2 logs
            try {
                $pm2Logs = pm2 logs $AppName --lines 10 --nostream 2>&1
                if ($pm2Logs -and $pm2Logs.Count -gt 0) {
                    $consoleLogFile = Join-Path $LogsDir "pm2-console.log"
                    
                    foreach ($line in $pm2Logs) {
                        if ($line -and $line.ToString().Trim() -ne "") {
                            $timestamp = Get-Timestamp
                            $logEntry = "[$timestamp] $line"
                            Add-Content -Path $consoleLogFile -Value $logEntry -Encoding UTF8
                        }
                    }
                }
            } catch {
                Write-LogEntry "Failed to capture PM2 logs: $($_.Exception.Message)" "ERROR" $pm2LogFile
            }
            
        } catch {
            Write-LogEntry "Monitor error: $($_.Exception.Message)" "ERROR" $pm2LogFile
        }
        
        # Wait 30 seconds before next check
        Start-Sleep -Seconds 30
    }
}

# Function to capture current PM2 logs
function Get-PM2Logs {
    try {
        $outputFile = Join-Path $LogsDir "pm2-logs-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
        
        Write-Host "Capturing PM2 logs for app: $AppName" -ForegroundColor Green
        Write-Host "Output file: $outputFile" -ForegroundColor Green
        
        # Get all PM2 logs
        $logs = pm2 logs $AppName --lines 1000 --nostream 2>&1
        
        if ($logs) {
            $logs | Out-File -FilePath $outputFile -Encoding UTF8
            Write-Host "Logs captured successfully!" -ForegroundColor Green
            Write-Host "File size: $((Get-Item $outputFile).Length / 1KB) KB" -ForegroundColor Cyan
        } else {
            Write-Host "No logs found for app: $AppName" -ForegroundColor Yellow
        }
        
        # Also capture PM2 status
        $statusFile = Join-Path $LogsDir "pm2-status-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
        $status = pm2 jlist | ConvertFrom-Json
        $status | ConvertTo-Json -Depth 10 | Out-File -FilePath $statusFile -Encoding UTF8
        
        Write-Host "Status captured: $statusFile" -ForegroundColor Green
        
    } catch {
        Write-Host "Error capturing logs: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Main execution
Write-Host "PM2 Log Capture Script" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan

# Check if PM2 is available
try {
    $pm2Version = pm2 --version
    Write-Host "PM2 Version: $pm2Version" -ForegroundColor Green
} catch {
    Write-Host "PM2 not found. Please install PM2 first: npm install -g pm2" -ForegroundColor Red
    exit 1
}

if ($Monitor) {
    Write-Host "Starting continuous monitoring..." -ForegroundColor Yellow
    Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Yellow
    Start-PM2Monitor
} else {
    Write-Host "Capturing current logs..." -ForegroundColor Yellow
    Get-PM2Logs
}
