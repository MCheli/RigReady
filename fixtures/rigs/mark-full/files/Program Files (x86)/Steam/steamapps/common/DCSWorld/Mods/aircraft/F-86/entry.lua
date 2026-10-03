local self_ID = "F-86F Sabre by Belsimtek"
declare_plugin(self_ID,
{
image     	 = "F-86F Sabre.png",
installed 	 = true, -- if false that will be place holder , or advertising
dirName	  	 = current_mod_path,
displayName  = _("F-86F Sabre"),
shortName	 =   "F-86F",
fileMenuName = _("F-86F"),
update_id    = "F-86F",
registryPath = "Eagle Dynamics\\F86",
version		 = __DCS_VERSION__,		 
state		 = "installed",
developerName= _("Belsimtek"),
info		 = _("The North American F-86 Sabre was a transonic jet fighter aircraft. Produced by North American Aviation, the Sabre is best known as the United States' first swept wing fighter which could counter the similarly-winged Soviet MiG-15 in high-speed dogfights over the skies of the Korean War."),

binaries 	 =
{
'F86',
},
Skins	= 
	{
		{
			name	= _("F-86F"),
			dir		= "Skins/1"
		},
	},
Missions =
	{
		{
			name		= _("F-86F"),
			dir			= "Missions",
			CLSID		= "{F-86F Sabre missions}",	
		},
	},	
LogBook =
	{
		{
			name		= _("F-86F"),
			type		= "F-86F Sabre",
		},
	},

Options =
	{
		{
			name		= _("F-86F"),
			nameId		= "F-86F",
			dir			= "Options",
			CLSID		= "{F-86F Sabre options}"
		},
	},
	
InputProfiles =
	{
		["F-86F Sabre"]     = current_mod_path .. '/Input/F-86F',
	},
})

--cockpit
mount_vfs_liveries_path (current_mod_path.."/Liveries")
mount_vfs_model_path	(current_mod_path.."/Cockpit/Shape")
mount_vfs_texture_path  (current_mod_path.."/Cockpit/Textures/F-86F-35-CPT-TEXTURES")
mount_vfs_texture_path  (current_mod_path ..  "/Skins/1/ME")

local cfg_path = current_mod_path ..  "/FM/config.lua"
dofile(cfg_path)
F86FM[1]				= self_ID
F86FM[2]				= 'F86'
F86FM.config_path		= cfg_path
F86FM.user_options      = 'F-86F'

dofile(current_mod_path.."/Views.lua")
make_view_settings('F-86F Sabre', ViewSettings, SnapViews)

make_flyable('F-86F Sabre',current_mod_path..'/Cockpit/Scripts/',F86FM,current_mod_path..'/comm.lua') -- AFM
set_manual_path('F-86F Sabre', current_mod_path .. '/Doc/manual')
plugin_done()-- finish declaration , clear temporal data
