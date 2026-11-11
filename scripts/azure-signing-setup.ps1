<#
  RigReady code signing: the Azure and GitHub setup, in two parts.
    Nothing here runs until the owner has created the pay-as-you-go subscription.

  Part A, after the subscription exists (the owner: az login first):
    .\azure-signing-setup.ps1 -Part A -SubscriptionId <id>
    Registers Microsoft.CodeSigning, creates the resource group and the signing account
    (East US, Basic), and gives the owner the Identity Verifier role on it.
    Then the owner does the identity validation in the portal (ID photo and face check).

  Part B, after the identity validation shows Completed:
    .\azure-signing-setup.ps1 -Part B -SubscriptionId <id> -ValidationId <guid> -Publisher "<CN exactly as validated>"
    Creates the certificate profile, the app registration with a client secret (stored
    straight into GitHub secrets, never printed), gives it the Certificate Profile Signer
    role, and sets the four repository variables.
#>
param(
  [Parameter(Mandatory)] [ValidateSet('A', 'B')] [string] $Part,
  [Parameter(Mandatory)] [string] $SubscriptionId,
  [string] $ValidationId,
  [string] $Publisher,
  [string] $ResourceGroup = 'rigready-signing',
  [string] $Location = 'eastus',
  [string] $Account = 'rigready',
  [string] $CertProfile = 'rigready-public',
  [string] $AppName = 'rigready-release-signing',
  [string] $Repo
)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = (& 'C:\Program Files\GitHub CLI\gh.exe' repo view --json nameWithOwner -q .nameWithOwner) }
$az = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
function Az { & $az @args --only-show-errors; if ($LASTEXITCODE) { throw "az $($args -join ' ') failed" } }
# The roles were renamed from "Trusted Signing ..." to "Artifact Signing ..."; use whichever exists.
function RoleName([string] $suffix) {
  foreach ($prefix in 'Artifact Signing', 'Trusted Signing') {
    $n = Az role definition list --name "$prefix $suffix" --query '[0].roleName' -o tsv
    if ($n) { return $n }
  }
  throw "No role named '... $suffix' was found"
}

Az account set --subscription $SubscriptionId
$tenant = (Az account show --query tenantId -o tsv)
$accountId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.CodeSigning/codeSigningAccounts/$Account"

if ($Part -eq 'A') {
  Az provider register --namespace Microsoft.CodeSigning --wait
  Az group create -n $ResourceGroup -l $Location -o none
  $free = Az artifact-signing check-name-availability --type Microsoft.CodeSigning/codeSigningAccounts -n $Account --query nameAvailable -o tsv
  if ($free -ne 'true') { throw "The signing account name '$Account' is taken; run again with -Account <another name>" }
  Az artifact-signing create -n $Account -g $ResourceGroup -l $Location --sku Basic -o none
  $me = Az ad signed-in-user show --query id -o tsv
  Az role assignment create --assignee-object-id $me --assignee-principal-type User `
    --role (RoleName 'Identity Verifier') --scope $accountId -o none
  $endpoint = Az artifact-signing show -n $Account -g $ResourceGroup --query accountUri -o tsv
  Write-Host "Part A done. Account $Account at $endpoint."
  Write-Host 'Next (the owner): portal > the signing account > Identity validations > New > Public, Individual; then the ID and face check.'
  exit 0
}

if (-not $ValidationId -or -not $Publisher) { throw 'Part B needs -ValidationId and -Publisher (both from the completed identity validation).' }
Az artifact-signing certificate-profile create -g $ResourceGroup --account-name $Account -n $CertProfile `
  --profile-type PublicTrust --identity-validation-id $ValidationId -o none

$appId = Az ad app create --display-name $AppName --sign-in-audience AzureADMyOrg --query appId -o tsv
Az ad sp create --id $appId -o none
$spId = Az ad sp show --id $appId --query id -o tsv
Az role assignment create --assignee-object-id $spId --assignee-principal-type ServicePrincipal `
  --role (RoleName 'Certificate Profile Signer') --scope "$accountId/certificateProfiles/$CertProfile" -o none

# The secret goes straight from Azure into GitHub; it is never printed or written to disk.
$secret = Az ad app credential reset --id $appId --display-name 'GitHub release workflow' --years 2 --query password -o tsv
# --body, not a pipe: a piped value arrives with a line ending, and Azure then rejects it.
& $gh secret set AZURE_CLIENT_SECRET --repo $Repo --body $secret.Trim()
Remove-Variable secret
& $gh secret set AZURE_TENANT_ID --repo $Repo --body $tenant.Trim()
& $gh secret set AZURE_CLIENT_ID --repo $Repo --body $appId.Trim()

$endpoint = Az artifact-signing show -n $Account -g $ResourceGroup --query accountUri -o tsv
& $gh variable set RIGREADY_SIGN_ENDPOINT --repo $Repo --body $endpoint.TrimEnd('/')
& $gh variable set RIGREADY_SIGN_ACCOUNT --repo $Repo --body $Account
& $gh variable set RIGREADY_SIGN_PROFILE --repo $Repo --body $CertProfile
& $gh variable set RIGREADY_SIGN_PUBLISHER --repo $Repo --body $Publisher

$expires = (Get-Date).AddYears(2).ToString('yyyy-MM-dd')
Write-Host "Part B done. Seven values set on $Repo. The client secret expires about ${expires}; renew it before then (docs/RELEASING.md)."
