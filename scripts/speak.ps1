param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Speech
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $text = [string]$request.text
    if ($text.Length -lt 1 -or $text.Length -gt 200) { throw 'Text must be 1 to 200 characters' }
    $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        $speaker.Rate = 0
        $speaker.SetOutputToWaveFile($OutputPath)
        $speaker.Speak($text)
    } finally { $speaker.Dispose() }
} catch { [Console]::Error.WriteLine('Local Windows speech synthesis failed'); exit 1 }
