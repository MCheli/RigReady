-- RigReady test fixture: only the lines it reads, from DCS World's Mods/aircraft/F-16C/Cockpit/Scripts/Displays/MFD/indicator/MFD_left_init.lua
	dofile(LockOn_Options.common_script_path.."ViewportHandling.lua")
	update_screenspace_diplacement(1, true, 0)
	try_find_assigned_viewport("LEFT_MFCD")
end
