local self_ID = "MiG-29 Fulcrum by Eagle Dynamics"
declare_plugin(self_ID,
{
image     		 = "MiG-29.bmp",
installed 		 = true, -- if false that will be place holder , or advertising
dirName	  	 	 = current_mod_path,

fileMenuName 	 = _("MiG-29"),
displayName 	 = _("MiG-29"),
update_id        = "MIG-29",
version		 	 = __DCS_VERSION__,
state		 	 = "installed",
info		 	 = _("A single seat, twin-engined, fourth generation supersonic fighter aircraft born during the closing phase of the Cold War. With primary roles being Combat Air Patrol, close range intercept and air superiority."), --!!!!

binaries 	 =
{
'MiG29',
'MIG29CWS'
},

InputProfiles =
{
    ["mig-29"] = current_mod_path .. '/Input/mig-29',
    ["mig-29c"] = current_mod_path .. '/Input/mig-29c',
    ["mig-29g"] = current_mod_path .. '/Input/mig-29g',
},


Skins	=
	{
		{
			name	= _("MiG-29"),
			dir		= "Skins/1"
		},
	},

Missions =
	{
		{
			name		= _("MiG-29"),
			dir			= "Missions",
		},
	},	
LogBook =
	{
		{
			name		= _("MiG-29A"),
			type		= "MiG-29A",
		},
		{
			name		= _("MiG-29G"),
			type		= "MiG-29G",
		},
		{
			name		= _("MiG-29S"),
			type		= "MiG-29S",
		},
	},	
Options =
    {
        {
            name		= _("MiG-29"),
            nameId		= "MiG-29",
            dir			= "Options",
            CLSID		= "{MiG-29 options}"
        },
    }, 	
})

mount_vfs_texture_path(current_mod_path ..  "/Skins/1/ME")--for simulator loading window
mount_vfs_texture_path  (current_mod_path ..  "/Cockpit/Textures/MIG-29-13-CPT-TEXTURES")
mount_vfs_model_path    (current_mod_path ..  "/Cockpit/Shape")
mount_vfs_liveries_path (current_mod_path ..  "/Liveries")


----------------------------------------------------------------------------------------
--make_flyable(obj_name,optional_cockpit path,optional_fm = {mod_of_fm_origin,dll_with_fm})
MAC_flyable('MiG-29A'	, current_mod_path..'/Cockpit/KneeboardLeft/', {self_ID,'MiG29',old = true}, current_mod_path..'/Comm/MiG-29A.lua')
make_flyable('MiG-29G'	, current_mod_path..'/Cockpit/KneeboardLeft/', {self_ID,'MiG29',old = true}, current_mod_path..'/Comm/MiG-29G.lua')
MAC_flyable('MiG-29S'	, current_mod_path..'/Cockpit/KneeboardLeft/', {self_ID,'MiG29',old = true}, current_mod_path..'/Comm/MiG-29S.lua')
----------------------------------------------------------------------------------------
plugin_done()
