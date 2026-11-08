$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$client = $null
$message = $null
$response = $null
$stream = $null
$metadataWritten = $false

function Write-ProtocolLine([string]$marker, [hashtable]$payload) {
    $json = $payload | ConvertTo-Json -Compress -Depth 8
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    $bytes = [Text.Encoding]::ASCII.GetBytes("$marker $encoded`n")
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

function Test-HopByHopHeader([string]$name) {
    return $name -match '^(?i:connection|content-length|host|keep-alive|proxy-connection|te|trailer|transfer-encoding|upgrade)$'
}

try {
    $raw = [Console]::In.ReadToEnd()
    $request = $raw | ConvertFrom-Json -Depth 32

    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.AutomaticDecompression = (
        [Net.DecompressionMethods]::GZip -bor
        [Net.DecompressionMethods]::Deflate -bor
        [Net.DecompressionMethods]::Brotli
    )
    $client = [Net.Http.HttpClient]::new($handler, $true)
    $client.Timeout = [TimeSpan]::FromMinutes(10)

    $uri = [Uri][string]$request.url
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'api.arena.ai' -or (-not $uri.IsDefaultPort -and $uri.Port -ne 443)) {
        throw "Refusing non-canonical Arena origin: $($uri.GetLeftPart([UriPartial]::Authority))"
    }
    $method = [Net.Http.HttpMethod]::new([string]$request.method)
    $message = [Net.Http.HttpRequestMessage]::new($method, $uri)

    if (-not [string]::IsNullOrEmpty([string]$request.bodyBase64)) {
        $bodyBytes = [Convert]::FromBase64String([string]$request.bodyBase64)
        $message.Content = [Net.Http.ByteArrayContent]::new($bodyBytes)
    }

    if ($null -ne $request.headers) {
        foreach ($property in $request.headers.PSObject.Properties) {
            $name = [string]$property.Name
            if (Test-HopByHopHeader $name) {
                continue
            }
            $value = [string]$property.Value
            if (-not $message.Headers.TryAddWithoutValidation($name, $value) -and $null -ne $message.Content) {
                [void]$message.Content.Headers.TryAddWithoutValidation($name, $value)
            }
        }
    }

    $response = $client.SendAsync($message, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $responseHeaders = @{}
    foreach ($entry in $response.Headers) {
        $name = [string]$entry.Key
        if (Test-HopByHopHeader $name) {
            continue
        }
        $responseHeaders[$name] = [string]::Join(', ', [string[]]$entry.Value)
    }
    foreach ($entry in $response.Content.Headers) {
        $name = [string]$entry.Key
        if ((Test-HopByHopHeader $name) -or $name -match '^(?i:content-encoding)$') {
            continue
        }
        $responseHeaders[$name] = [string]::Join(', ', [string[]]$entry.Value)
    }

    Write-ProtocolLine 'ARENAHTTP/1' @{
        status = [int]$response.StatusCode
        statusText = [string]$response.ReasonPhrase
        headers = $responseHeaders
    }
    $metadataWritten = $true

    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $stdout = [Console]::OpenStandardOutput()
    $buffer = [byte[]]::new(65536)
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $stdout.Write($buffer, 0, $read)
        $stdout.Flush()
    }
}
catch {
    if (-not $metadataWritten) {
        Write-ProtocolLine 'ARENAERROR/1' @{ error = $_.Exception.Message }
    }
    else {
        [Console]::Error.WriteLine($_.Exception.Message)
    }
    exit 1
}
finally {
    if ($null -ne $stream) { $stream.Dispose() }
    if ($null -ne $response) { $response.Dispose() }
    if ($null -ne $message) { $message.Dispose() }
    if ($null -ne $client) { $client.Dispose() }
}
