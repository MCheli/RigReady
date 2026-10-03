local self_ID = "Ka-50 Black Shark 3 by Eagle Dynamics"
declare_plugin(self_ID,
{
image     	 = "Ka-50.bmp",
installed 	 = true,
dirName	  	 = current_mod_path,

fileMenuName = _("Ka-50 III"),
update_id    = "KA-50_3",
displayName  = _("Ka-50 Black Shark 3"),
shortName	 = "Ka-50 III",
version		 = __DCS_VERSION__,
state		 = "installed",
info		 = _('The Ka-50 is a Russian single seat attack helicopter with unique counter-rotating rotors. The Black Shark 3 has added a Missile Warning System and an Air-to-Air "Igla" missiles, which will make it possible to combat with subsonic aircraft. In addition, a physical model of the Inertial Navigation System has been added, with its inherent features.'),
binaries 	 =
{
'Ka50',
'CockpitKa50',
'CockpitKa50_3',
},

InputProfiles =
{
    ["Ka-50 III"]      = current_mod_path .. '/input/ka-50_3',
},


Skins	=
	{
		{
			name	= _("Ka-50 III"),
			dir		= "Skins/1"
		},
	},

Missions =
	{
		{
			name		    = _("Ka-50 III"),
			dir			    = "Missions",
		},
	},	

LogBook =
	{
		{
			name		= _("Ka-50 III"),
			type		= "Ka-50_3",
		},
	},	

Options =
	{
		{
			name		= _("Ka-50 III"),
			nameId		= "Ka-50_3",
			dir			= "Options",
		},
	},

preload_resources = {
	textures   = 
		{
			"KA-50-blade.bmp",
			"DAMAGE_Ka-50_n.bmp",
			"DAMAGE_Ka-50_n1.bmp",
			"DAMAGE_Ka-50_1.tga",
			"DAMAGE_KA-50_2.bmp",			
		},
	models     = {},
	fonts      = {},
	explosions = {},
	},
})

mount_vfs_liveries_path(current_mod_path .. "/Liveries")
mount_vfs_texture_path(current_mod_path ..  "/Skins/1/ME")--for simulator loading window

dofile(current_mod_path.."/Views.lua")
make_view_settings('Ka-50_3', ViewSettings, SnapViews)

----------------------------------------------------------------------------------------
make_flyable('Ka-50_3',current_mod_path..'/Cockpit/Scripts/',{self_ID,'Ka50'}, current_mod_path..'/comm.lua')--make_flyable(obj_name,optional_cockpit path,optional_fm = {mod_of_fm_origin,dll_with_fm})
----------------------------------------------------------------------------------------
plugin_done()
