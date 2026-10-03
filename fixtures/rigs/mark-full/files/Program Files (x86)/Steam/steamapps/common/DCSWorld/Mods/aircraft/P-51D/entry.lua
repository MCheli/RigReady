local self_ID = "P-51D Mustang by Eagle Dynamics"
declare_plugin(self_ID,
{
installed 	 = true, -- if false that will be place holder , or advertising
dirName	  	 = current_mod_path,

displayName	 = _("P-51D Mustang"),
fileMenuName = _("P-51D"),
update_id        = "P-51D",
registryPath	 = "Eagle Dynamics\\Mustang",
version		 = __DCS_VERSION__,
state		 = "installed",
info		 = _("The Mustang was among the best and most well-known fighters used by the U.S. Army Air Forces during WWII. Possessing excellent range and maneuverability, the P-51 operated primarily as a long-range escort fighter and also as a ground attack fighter-bomber with bombs, rockets, and machine guns. The Mustang served in nearly every combat zone during WWII and proved to be what many consider the most successful fighter in history."),
binaries 	 =
{
'P51B',
'Cockpit_P51D'
},

InputProfiles =
{
    ["P-51D"]            = current_mod_path .. '/Input/P-51D',
},



Skins	=
	{
		{
			name	= _("P-51D"),
			dir		= "Skins/1"
		},
	},

Missions =
	{
		{
			name		= _("P-51D"),
			dir			= "Missions",	
		},
	},	

Options = 
	{
		{
			name		= _("P-51D"),
			nameId		= "P-51D",
			dir			= "Options",
		},
	},
LogBook =
	{
		{
			name		= _("P-51D"),
			type		= "P-51D",
		},
		{
			name		= _("P-51D-30-NA"),
			type		= "P-51D-30-NA",
		},
	},		
preload_resources = 
	{
		textures   = {},
		models     = {"tracer_bullet_a-10", "shell_50cal", "tracer_bullet_red", "sled"},
		fonts      = {},
		explosions = {},
	},
})

mount_vfs_liveries_path(current_mod_path .. "/Liveries")
mount_vfs_texture_path(current_mod_path ..  "/Skins/1/ME")--for simulator loading window

----------------------------------------------------------------------------------------
make_flyable(
    'P-51D',
    current_mod_path .. '/Cockpit/Scripts/',
    {self_ID, 'P51B'},
    current_mod_path .. '/comm.lua'
) -- make_flyable(obj_name,optional_cockpit path,optional_fm = {mod_of_fm_origin,dll_with_fm})
make_flyable(
    'P-51D-30-NA',
    current_mod_path .. '/Cockpit/Scripts/',
    {self_ID, 'P51B'},
    current_mod_path .. '/comm.lua'
) -- make_flyable(obj_name,optional_cockpit path,optional_fm = {mod_of_fm_origin,dll_with_fm})

set_manual_path('P-51D', current_mod_path .. '/Doc/manual')
----------------------------------------------------------------------------------------
plugin_done()
