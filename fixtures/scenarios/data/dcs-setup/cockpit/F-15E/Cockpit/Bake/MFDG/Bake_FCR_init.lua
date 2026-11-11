-- RigReady test fixture: only the lines it reads, from DCS World's Mods/aircraft/F-15E/Cockpit/Bake/MFDG/Bake_FCR_init.lua
dofile(LockOn_Options.script_path.."Bake/MFDG/Bake_Common_Page.lua")
create_mfd_init("FCR")
try_find_assigned_viewport("RIGHT_MFCD")
