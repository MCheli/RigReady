-- RigReady test fixture: only the lines it reads, from DCS World's Mods/aircraft/A-10C_2/Cockpit/Scripts/MFCD/indicator/MFCD_init.lua
	if disposition == 'L' then
		try_find_assigned_viewport("LEFT_MFCD")
	else
		try_find_assigned_viewport("RIGHT_MFCD")
	end
