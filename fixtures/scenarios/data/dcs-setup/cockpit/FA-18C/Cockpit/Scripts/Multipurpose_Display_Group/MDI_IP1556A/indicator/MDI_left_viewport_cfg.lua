-- RigReady test fixture: only the lines it reads, from DCS World's Mods/aircraft/FA-18C/Cockpit/Scripts/Multipurpose_Display_Group/MDI_IP1556A/indicator/MDI_left_viewport_cfg.lua
--ViewportHandling
dofile(LockOn_Options.common_script_path.."ViewportHandling.lua")
update_screenspace_diplacement(1, true, 0)
try_find_assigned_viewport("LEFT_MFCD")
