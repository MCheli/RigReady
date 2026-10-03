local self_ID = "F-15E by RAZBAM"

declare_plugin(self_ID, {
	dirName			= current_mod_path,
	displayName		= _("F-15E Suite 4+"),
	shortName		=   "F-15E S4+",
	fileMenuName	= _("F-15E"),
	update_id		= "RAZBAM_F-15E",
	version 		= __DCS_VERSION__,
	state			= "installed",
	developerName	= _("RAZBAM"),
	info			= _("The F-15E is a dual-role fighter designed to perform air-to-air and air-to-ground missions. An array of avionics and electronics systems gives the F-15E the capability to fight at low altitude, day or night and in all weather. The aircraft uses two crew members, a pilot and a weapon systems officer. Previous models of the F-15 are assigned air-to-air roles; the 'E' model is a dual-role fighter. It has the capability to fight its way to a target over long ranges, destroy enemy ground positions and fight its way out."),
	
	binaries = {	
		'F15E_CPT',
        'F15E_FM',	
		'ARF',
	},
	
	Skins = {
		{
			name	= "F-15E",
			dir		= "Theme/1"
		},
	},
	
	Missions = {
		{
			name	= _("F-15E"),
			dir		= "Missions",
			CLSID	= "{F-15ESE missions}",
		},
	},
	
	LogBook = {
		{
			name	= _("F-15E"),
			type	= "F-15ESE",
		},
	},
	
	Options = {
		{
			name		= _("F-15E"),
			nameId		= "F-15ESE",
			dir			= "Options",
			CLSID		= "{F-15ESE options}"
		},
	},
	
	InputProfiles = {
		["F-15E"]		= current_mod_path .. '/Input/F-15E/',
		["F-15E_WSO"]	= current_mod_path .. '/Input/F-15E_WSO/',
	},
	
})

-------------------------------------------------------------------------------
mount_vfs_model_path    (current_mod_path ..  "/Shapes")
mount_vfs_liveries_path (current_mod_path ..  "/Liveries")
mount_vfs_texture_path  (current_mod_path ..  "/Theme/1/ME")--for simulator loading window
mount_vfs_texture_path  (current_mod_path ..  "/Textures/F-15E-CPT")
mount_vfs_texture_path  (current_mod_path ..  "/Textures/F-15E-CPT-LOW")
-------------------------------------------------------------------------------
dofile(current_mod_path.."/Views.lua")
make_view_settings('F-15ESE', ViewSettings, SnapViews)
---------------------------------------------------------------------------------------
-- EFM START
---------------------------------------------------------------------------------------
local cfg_path = current_mod_path ..  "/FM/config.lua"
dofile(cfg_path)
F15EFM[1] 				= self_ID
F15EFM[2] 				= 'F15E_FM'
F15EFM.config_path 		= cfg_path
---------------------------------------------------------------------------------------
-- EFM END
---------------------------------------------------------------------------------------
make_flyable("F-15ESE", current_mod_path..'/Cockpit/',F15EFM,current_mod_path..'/comm.lua') -- EFM ON
--make_flyable('F-15ESE', current_mod_path..'/Cockpit/', nil, current_mod_path..'/comm.lua') -- SFM ON
---------------------------------------------------------------------------------------
turn_on_waypoint_panel('F-15ESE', true, true)

plugin_done()-- finish declaration , clear temporal data
