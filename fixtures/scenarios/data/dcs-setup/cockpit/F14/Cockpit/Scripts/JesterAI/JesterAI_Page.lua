-- RigReady test fixture: only the lines it reads, from DCS World's Mods/aircraft/F14/Cockpit/Scripts/JesterAI/JesterAI_Page.lua
if GetSelf():is_VR() == false then
	local viewJester = find_viewport("F14_JESTER_MENU") or find_viewport("GU_MAIN_VIEWPORT")
