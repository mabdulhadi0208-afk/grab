'use strict';
// Pricing labels + starter packs. Grab only ever downloads the developer's official installer, so a paid app arrives as its
// normal trial / unlicensed version. These labels make sure nobody mistakes "Get" for "free", and point people to the developer to buy.
// Only well-known apps are listed; anything not here simply shows no price label.

const MAC_PAID = `bartender cleanmymac bettertouchtool istat-menus little-snitch micro-snitch sublime-text sublime-merge fork transmit nova dash
screenflow cleanshot daisydisk hazel keyboard-maestro omnifocus omnigraffle omniplan omnioutliner devonthink scrivener carbon-copy-cloner
forklift popclip launchbar moom swish soulver pdf-expert betterzip a-better-finder-rename mountain-duck viscosity charles kaleidoscope
beyond-compare araxis-merge navicat-premium crossover ableton-live-suite ableton-live-standard reaper bitwig-studio fl-studio capture-one
camtasia snagit principle rapidweaver wolfram-mathematica guitar-pro typora hopper-disassembler rhinoceros minecraft soundsource audio-hijack
loopback airfoil fission piezo farrago jump-desktop downie permute pixelsnap sip colorsnapper iconjar rightfont glyphs monodraw busycal
busycontacts mailmate default-folder-x totalfinder hazeover witch archiver textsoap typinator unclutter trickster lingon-x drivedx tripmode
path-finder istatistica`.split(/\s+/);
const MAC_SUB = `sketch parallels parallels-toolbox microsoft-office microsoft-word microsoft-excel microsoft-powerpoint adobe-creative-cloud
adobe-acrobat-pro 1password dashlane nordvpn expressvpn surfshark setapp tower superhuman textexpander timing merlin-project tableau
sketchup burp-suite-professional paste`.split(/\s+/);

const WIN_PAID = `SublimeHQ.SublimeText.4 SublimeHQ.SublimeMerge RARLab.WinRAR Mojang.MinecraftLauncher TechSmith.Camtasia TechSmith.Snagit
ScooterSoftware.BeyondCompare.5 ScooterSoftware.BeyondCompare4 Fork.Fork Cockos.REAPER Image-Line.FLStudio Bitwig.BitwigStudio Typora.Typora
PremiumSoft.NavicatPremium XK72.Charles Tonec.InternetDownloadManager Ghisler.TotalCommander Stardock.Fences Stardock.Start11
Bandicam.Bandicam Wondershare.Filmora Wondershare.PDFelement Corel.WinZip Wolfram.Mathematica`.split(/\s+/);
const WIN_SUB = `Microsoft.Office Adobe.Acrobat.Pro Adobe.CreativeCloud AgileBits.1Password NordSecurity.NordVPN NordVPN.NordVPN
ExpressVPN.ExpressVPN Surfshark.Surfshark Dashlane.Dashlane PrivateInternetAccess.PrivateInternetAccess CyberGhost.CyberGhostVPN
ESET.Nod32 ESET.Security Tableau.Desktop`.split(/\s+/);

const map = new Map();
for (const t of MAC_PAID) map.set('m:' + t, 'paid');
for (const t of MAC_SUB) map.set('m:' + t, 'sub');
for (const t of WIN_PAID) map.set('w:' + t.toLowerCase(), 'paid');
for (const t of WIN_SUB) map.set('w:' + t.toLowerCase(), 'sub');

// Trial lengths, only where the developer's own pages state them (checked Nov 2026). No entry = no trial claim, the button says Buy.
const TRIALS = {
  'm:bartender': '4-week trial', 'm:cleanmymac': '7-day trial', 'm:sublime-text': 'Free to try', 'm:parallels': '14-day trial',
  'm:1password': '14-day trial', 'm:microsoft-office': '1-month trial', 'm:sketch': '30-day trial', 'm:istat-menus': '14-day trial',
  'm:bettertouchtool': '45-day trial', 'm:adobe-creative-cloud': '7-day trial', 'm:minecraft': '100-min demo', 'm:typora': '15-day trial',
  'w:rarlab.winrar': '40-day trial', 'w:sublimehq.sublimetext.4': 'Free to try', 'w:agilebits.1password': '14-day trial',
  'w:microsoft.office': '1-month trial', 'w:adobe.creativecloud': '7-day trial', 'w:mojang.minecraftlauncher': '100-min demo', 'w:typora.typora': '15-day trial',
};
const TRIAL_NOTE = { 'Free to try': 'The developer lets you evaluate it with no enforced time limit; a licence is required for continued use.', '100-min demo': 'The free demo lasts about 100 minutes of play.' };
function trialOf(id, isMac) {
  id = String(id || '');
  const t = TRIALS[isMac ? 'm:' + id : 'w:' + id.toLowerCase()] || '';
  return t ? { label: t, note: TRIAL_NOTE[t] || `The developer offers a ${t.replace(' trial', '')} free trial.` } : null;
}

// '' | 'paid' | 'sub'
function priceOf(id, isMac) {
  id = String(id || '');
  return map.get(isMac ? 'm:' + id.split('@')[0] : 'w:' + id.toLowerCase()) || '';
}

const PACKS = {
  mac: [
    { id: 'essentials', name: 'Essentials', blurb: 'The first apps for a fresh Mac', hue: 255, ids: ['google-chrome', 'vlc', 'the-unarchiver', 'rectangle', 'appcleaner', 'raycast'] },
    { id: 'chat', name: 'Chat & calls', blurb: 'Stay in touch', hue: 200, ids: ['discord', 'whatsapp', 'telegram', 'slack', 'zoom', 'signal'] },
    { id: 'create', name: 'Creator kit', blurb: 'Record, edit, design', hue: 320, ids: ['obs', 'handbrake-app', 'audacity', 'blender', 'capcut', 'figma'] },
    { id: 'code', name: 'Coding', blurb: 'Everything to start building', hue: 150, ids: ['visual-studio-code', 'iterm2', 'docker-desktop', 'cursor', 'github', 'postman'] },
    { id: 'games', name: 'Gaming', blurb: 'Launchers and voice chat', hue: 20, ids: ['steam', 'epic-games', 'discord', 'obs'] },
  ],
  win: [
    { id: 'essentials', name: 'Essentials', blurb: 'The first apps for a fresh PC', hue: 255, ids: ['Google.Chrome', 'VideoLAN.VLC', '7zip.7zip', 'Microsoft.PowerToys', 'ShareX.ShareX', 'Notepad++.Notepad++'] },
    { id: 'chat', name: 'Chat & calls', blurb: 'Stay in touch', hue: 200, ids: ['Discord.Discord', 'WhatsApp.WhatsApp', 'Telegram.TelegramDesktop', 'SlackTechnologies.Slack', 'Zoom.Zoom', 'OpenWhisperSystems.Signal'] },
    { id: 'create', name: 'Creator kit', blurb: 'Record, edit, design', hue: 320, ids: ['OBSProject.OBSStudio', 'HandBrake.HandBrake', 'Audacity.Audacity', 'BlenderFoundation.Blender', 'Bytedance.CapCut', 'Figma.Figma'] },
    { id: 'code', name: 'Coding', blurb: 'Everything to start building', hue: 150, ids: ['Microsoft.VisualStudioCode', 'Git.Git', 'Docker.DockerDesktop', 'Anysphere.Cursor', 'GitHub.GitHubDesktop', 'Postman.Postman'] },
    { id: 'games', name: 'Gaming', blurb: 'Launchers and voice chat', hue: 20, ids: ['Valve.Steam', 'EpicGames.EpicGamesLauncher', 'Blizzard.BattleNet', 'Discord.Discord', 'OBSProject.OBSStudio'] },
  ],
};

module.exports = { priceOf, trialOf, PACKS };
