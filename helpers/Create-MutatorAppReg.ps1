#Requires -Version 5.1
<#
.SYNOPSIS
    Creates the Entra ID (Azure AD) app registration that M365Mutator needs,
    with the required Microsoft Graph application permissions.

.DESCRIPTION
    Signs you in to Microsoft Graph interactively, creates an app registration
    for the workloads you choose, attaches the matching Graph *application*
    permissions, creates a service principal and a credential, and (optionally)
    grants tenant-wide admin consent.

    The credential is a client secret by default. If the tenant's app-management
    policy blocks secrets (CredentialTypeNotAllowedAsPerAppPolicy) — or you pass
    -UseCertificate — the script instead generates a self-signed certificate,
    uploads its public key to the app, and writes a PEM (certificate + private
    key) for M365Mutator's GRAPH_CERTIFICATE_PATH. The certificate path requires
    PowerShell 7+.

    At the end it prints the three values M365Mutator needs on its Settings
    page: the Tenant ID, the Client (application) ID, and the Client secret.
    The secret is shown only once — copy it before closing the window.

.PARAMETER DisplayName
    Display name for the app registration. Can also be supplied as -Name.
    Default: "M365Mutator".

.PARAMETER Workloads
    Which workloads to grant permissions for. Any of: Identities, Mail,
    Calendar, OneDrive, SharePoint. Default: all of them.

.PARAMETER SecretValidityMonths
    How long the generated client secret is valid, in months. Default: 6.

.PARAMETER GrantConsent
    Also grant tenant admin consent for the assigned permissions. Requires you
    to sign in as an administrator who can consent (e.g. Global Administrator
    or Privileged Role Administrator). Without this switch you must grant
    consent yourself in the Entra portal afterwards.

.PARAMETER UseCertificate
    Create a self-signed certificate credential instead of a client secret.
    This is also used automatically as a fallback when the tenant blocks
    secrets. Requires PowerShell 7+.

.PARAMETER CertificateOutputPath
    Where to write the generated PEM (certificate + private key). Defaults to
    "<DisplayName>.pem" in the current directory. The file contains the private
    key — protect it and do not commit it.

.EXAMPLE
    ./Create-MutatorAppReg.ps1
    Creates an app named "M365Mutator" with permissions for every workload,
    then prints the credentials. You grant consent manually afterwards.

.EXAMPLE
    ./Create-MutatorAppReg.ps1 -Workloads Identities,Mail -GrantConsent
    Creates an app limited to the Identities and Mail workloads and grants
    admin consent automatically.

.NOTES
    Requires the Microsoft Graph PowerShell SDK:
        Install-Module Microsoft.Graph -Scope CurrentUser

    These are tenant-wide, high-privilege permissions. Only grant the
    workloads you actually intend to use, and protect the client secret.
#>

[CmdletBinding()]
param(
    [Alias('Name')]
    [string]$DisplayName = 'M365Mutator',

    [ValidateSet('Identities', 'Mail', 'Calendar', 'OneDrive', 'SharePoint')]
    [string[]]$Workloads = @('Identities', 'Mail', 'Calendar', 'OneDrive', 'SharePoint'),

    [ValidateRange(1, 24)]
    [int]$SecretValidityMonths = 6,

    [switch]$GrantConsent,

    [switch]$UseCertificate,

    [string]$CertificateOutputPath
)

$ErrorActionPreference = 'Stop'

# Microsoft Graph's well-known service principal appId (the resource these
# application permissions belong to).
$GraphAppId = '00000003-0000-0000-c000-000000000000'

# Workload -> required Graph application permissions. Keep in sync with the
# permission table in README.md.
$PermissionsByWorkload = @{
    Identities = @('User.ReadWrite.All')
    Mail       = @('Mail.ReadWrite', 'Mail.Send')
    Calendar   = @('Calendars.ReadWrite', 'MailboxSettings.Read')
    OneDrive   = @('Files.ReadWrite.All')
    SharePoint = @('Sites.ReadWrite.All')
}

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }

# Wrap a base64 string into 64-character PEM lines.
function Split-Base64 {
    param([string]$Text)
    $sb = [System.Text.StringBuilder]::new()
    for ($i = 0; $i -lt $Text.Length; $i += 64) {
        $len = [Math]::Min(64, $Text.Length - $i)
        [void]$sb.AppendLine($Text.Substring($i, $len))
    }
    $sb.ToString().TrimEnd()
}

# Generate a self-signed certificate, upload its public key to the app, and
# write a PEM (private key + certificate) for GRAPH_CERTIFICATE_PATH.
function New-AppCertificateCredential {
    param(
        [Parameter(Mandatory)][string]$ApplicationObjectId,
        [Parameter(Mandatory)][string]$Subject,
        [Parameter(Mandatory)][int]$ValidityMonths,
        [Parameter(Mandatory)][string]$OutputPath
    )

    if ($PSVersionTable.PSEdition -ne 'Core') {
        throw 'Certificate generation requires PowerShell 7+ (pwsh). Install it, or add a certificate manually in the Entra portal.'
    }

    Write-Step 'Generating a self-signed certificate'
    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    try {
        $dn  = [System.Security.Cryptography.X509Certificates.X500DistinguishedName]::new("CN=$Subject")
        $req = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
            $dn, $rsa,
            [System.Security.Cryptography.HashAlgorithmName]::SHA256,
            [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $notBefore = [System.DateTimeOffset]::UtcNow.AddDays(-1)
        $notAfter  = [System.DateTimeOffset]::UtcNow.AddMonths($ValidityMonths)
        $cert = $req.CreateSelfSigned($notBefore, $notAfter)

        Write-Step 'Uploading the public key to the app registration'
        $publicCertBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
        $keyCredential = @{
            Type        = 'AsymmetricX509Cert'
            Usage       = 'Verify'
            DisplayName = "CN=$Subject"
            Key         = $publicCertBytes
        }
        Update-MgApplication -ApplicationId $ApplicationObjectId -KeyCredentials @($keyCredential) -ErrorAction Stop

        Write-Step "Writing certificate + private key to $OutputPath"
        $certB64 = Split-Base64 ([System.Convert]::ToBase64String($publicCertBytes))
        $keyB64  = Split-Base64 ([System.Convert]::ToBase64String($rsa.ExportPkcs8PrivateKey()))
        $pem = @"
-----BEGIN PRIVATE KEY-----
$keyB64
-----END PRIVATE KEY-----
-----BEGIN CERTIFICATE-----
$certB64
-----END CERTIFICATE-----
"@
        Set-Content -Path $OutputPath -Value $pem -Encoding ascii
        if ($IsMacOS -or $IsLinux) { & chmod 600 $OutputPath }
        Write-Ok 'Certificate written (contains the private key — protect it).'
    }
    finally {
        $rsa.Dispose()
    }
}

# --- Preflight: required modules -------------------------------------------
Write-Step 'Checking for the Microsoft Graph PowerShell SDK'
$requiredModules = @('Microsoft.Graph.Authentication', 'Microsoft.Graph.Applications')
$missing = $requiredModules | Where-Object { -not (Get-Module -ListAvailable -Name $_) }
if ($missing) {
    Write-Error @"
Missing required module(s): $($missing -join ', ')
Install the Microsoft Graph SDK first:
    Install-Module Microsoft.Graph -Scope CurrentUser
"@
    return
}
Write-Ok 'SDK present.'

# --- Resolve the selected permission set -----------------------------------
$selectedPermissions = foreach ($w in $Workloads) { $PermissionsByWorkload[$w] }
$selectedPermissions = $selectedPermissions | Select-Object -Unique
Write-Step "Workloads: $($Workloads -join ', ')"
Write-Ok   "Permissions: $($selectedPermissions -join ', ')"

# --- Sign in interactively --------------------------------------------------
$scopes = @('Application.ReadWrite.All')
if ($GrantConsent) { $scopes += 'AppRoleAssignment.ReadWrite.All' }

Write-Step 'Signing in to Microsoft Graph (a browser window will open)'
Connect-MgGraph -Scopes $scopes -NoWelcome
$context = Get-MgContext
if (-not $context) { Write-Error 'Sign-in failed or was cancelled.'; return }
Write-Ok "Signed in to tenant $($context.TenantId) as $($context.Account)."

# --- Map permission names to Graph app-role IDs -----------------------------
Write-Step 'Resolving Graph application-permission IDs'
$graphSp = Get-MgServicePrincipal -Filter "appId eq '$GraphAppId'"
if (-not $graphSp) { Write-Error 'Could not find the Microsoft Graph service principal in this tenant.'; return }

$roles = foreach ($perm in $selectedPermissions) {
    $role = $graphSp.AppRoles |
        Where-Object { $_.Value -eq $perm -and $_.AllowedMemberTypes -contains 'Application' }
    if (-not $role) { Write-Error "Permission '$perm' is not a Graph application role in this tenant."; return }
    [pscustomobject]@{ Name = $perm; Id = $role.Id }
}
Write-Ok "Resolved $($roles.Count) permission(s)."

# --- Create or reuse the app registration ----------------------------------
$requiredResourceAccess = @(
    @{
        ResourceAppId  = $GraphAppId
        ResourceAccess = @($roles | ForEach-Object { @{ Id = $_.Id; Type = 'Role' } })
    }
)

Write-Step "Looking for an existing app registration named '$DisplayName'"
$existing = @(Get-MgApplication -Filter "displayName eq '$DisplayName'" -All -ErrorAction SilentlyContinue)
$reuse = $false
if ($existing.Count -gt 0) {
    $existingApp = $existing[0]
    $extra = if ($existing.Count -gt 1) { " (and $($existing.Count - 1) more with this name)" } else { '' }
    $choice = Read-Host "Found '$DisplayName' (AppId $($existingApp.AppId))$extra. [R]euse it, create a [N]ew one, or [A]bort? [R/n/a]"
    switch -Regex ($choice) {
        '^(a|abort)$' { Write-Host 'Aborted.' -ForegroundColor Yellow; Disconnect-MgGraph | Out-Null; return }
        '^(n|new)$'   { $reuse = $false }
        default       { $reuse = $true }   # Enter / R / anything else = reuse
    }
}

if ($reuse) {
    $app = $existingApp
    Write-Step "Reusing app registration (AppId $($app.AppId))"
    Update-MgApplication -ApplicationId $app.Id -RequiredResourceAccess $requiredResourceAccess -ErrorAction Stop
    Write-Ok 'Updated its permissions to match the selected workloads.'
}
else {
    Write-Step "Creating app registration '$DisplayName'"
    $app = New-MgApplication -DisplayName $DisplayName `
        -SignInAudience 'AzureADMyOrg' `
        -RequiredResourceAccess $requiredResourceAccess `
        -ErrorAction Stop
    Write-Ok "Created application. AppId: $($app.AppId)"
}

# --- Service principal (needed for consent / app-role assignments) ----------
Write-Step 'Ensuring a service principal exists'
$sp = Get-MgServicePrincipal -Filter "appId eq '$($app.AppId)'" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $sp) {
    $sp = New-MgServicePrincipal -AppId $app.AppId -ErrorAction Stop
    Write-Ok "Created service principal: $($sp.Id)"
}
else {
    Write-Ok "Reusing service principal: $($sp.Id)"
}

# --- Credential: client secret, or certificate if secrets are blocked -------
$credentialKind = $null
$secretText     = $null
$certPath       = $null

if (-not $CertificateOutputPath) {
    $CertificateOutputPath = Join-Path (Get-Location).Path "$DisplayName.pem"
}
elseif (Test-Path -LiteralPath $CertificateOutputPath -PathType Container) {
    # A directory was given — write "<DisplayName>.pem" inside it.
    $CertificateOutputPath = Join-Path $CertificateOutputPath "$DisplayName.pem"
}

if ($UseCertificate) {
    New-AppCertificateCredential -ApplicationObjectId $app.Id -Subject $DisplayName `
        -ValidityMonths $SecretValidityMonths -OutputPath $CertificateOutputPath
    $certPath = (Resolve-Path $CertificateOutputPath).Path
    $credentialKind = 'certificate'
}
else {
    Write-Step "Creating client secret (valid $SecretValidityMonths month(s))"
    $passwordCredential = @{
        displayName = "M365Mutator secret ($(Get-Date -Format 'yyyy-MM-dd'))"
        endDateTime = (Get-Date).AddMonths($SecretValidityMonths)
    }
    try {
        # -ErrorAction Stop is required: the module does not inherit the script's
        # $ErrorActionPreference, so without it a policy failure is non-terminating
        # and would skip the catch (and the certificate fallback).
        $secret = Add-MgApplicationPassword -ApplicationId $app.Id -PasswordCredential $passwordCredential -ErrorAction Stop
        $secretText = $secret.SecretText
        $credentialKind = 'secret'
        Write-Ok 'Secret created.'
    }
    catch {
        if (($_ | Out-String) -match 'CredentialTypeNotAllowed') {
            Write-Warning "This tenant's app-management policy blocks client secrets. Falling back to a certificate credential."
            New-AppCertificateCredential -ApplicationObjectId $app.Id -Subject $DisplayName `
                -ValidityMonths $SecretValidityMonths -OutputPath $CertificateOutputPath
            $certPath = (Resolve-Path $CertificateOutputPath).Path
            $credentialKind = 'certificate'
        }
        else {
            throw
        }
    }
}

# --- Optional: grant admin consent -----------------------------------------
$consentGranted = $false
if ($GrantConsent) {
    Write-Step 'Granting tenant admin consent'
    foreach ($role in $roles) {
        $assigned = $false
        # New service principals can take a few seconds to replicate; retry.
        for ($attempt = 1; $attempt -le 6 -and -not $assigned; $attempt++) {
            try {
                New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id `
                    -PrincipalId $sp.Id -ResourceId $graphSp.Id -AppRoleId $role.Id -ErrorAction Stop | Out-Null
                $assigned = $true
                Write-Ok "Consented: $($role.Name)"
            }
            catch {
                $msg = $_ | Out-String
                if ($msg -match 'already exists|Permission being assigned already exists|conflicting') {
                    $assigned = $true
                    Write-Ok "Already consented: $($role.Name)"
                }
                elseif ($attempt -eq 6) { Write-Warning "Could not consent '$($role.Name)': $($_.Exception.Message)" }
                else { Start-Sleep -Seconds 5 }
            }
        }
    }
    $consentGranted = $true
}

# --- Summary ----------------------------------------------------------------
Write-Host ''
Write-Host '============================================================' -ForegroundColor Magenta
Write-Host ' M365Mutator app registration ready' -ForegroundColor Magenta
Write-Host '============================================================' -ForegroundColor Magenta
Write-Host ''
Write-Host "  Tenant ID:      $($context.TenantId)"
Write-Host "  Client ID:      $($app.AppId)"
if ($credentialKind -eq 'secret') {
    Write-Host "  Client secret:  $secretText"
    Write-Host ''
    Write-Host '  Paste these into M365Mutator > Settings (secret goes in GRAPH_CLIENT_SECRET).' -ForegroundColor Yellow
    Write-Host '  The client secret is shown ONCE — copy it now.' -ForegroundColor Yellow
}
else {
    Write-Host "  Certificate:    $certPath"
    Write-Host ''
    Write-Host '  No client secret was created. Use the certificate instead:' -ForegroundColor Yellow
    Write-Host '  point GRAPH_CERTIFICATE_PATH at that PEM (it holds the private key —' -ForegroundColor Yellow
    Write-Host '  protect it, do not commit it). Tenant ID and Client ID go into' -ForegroundColor Yellow
    Write-Host '  M365Mutator > Settings as usual.' -ForegroundColor Yellow
}

if (-not $consentGranted) {
    Write-Host ''
    Write-Host '  Admin consent was NOT granted. Grant it in the Entra portal:' -ForegroundColor Yellow
    Write-Host "    Entra admin center > App registrations > $DisplayName"
    Write-Host '    > API permissions > Grant admin consent for <tenant>'
    Write-Host '  Or re-run this script with -GrantConsent as an administrator.'
}
Write-Host ''

Disconnect-MgGraph | Out-Null
