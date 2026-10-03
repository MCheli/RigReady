local self_ID = "Su-25A by Eagle Dynamics"
declare_plugin(self_ID,
{
installed 	 = true, -- if false that will be place holder , or advertising
dirName	  	 = current_mod_path,
displayName  = _("Su-25"),
Shortname    = _("Su-25"),
fileMenuName = _("Su-25"),
update_id        = "SU-25A",
registryPath	 = "Eagle Dynamics\\SU25A",
version		 = __DCS_VERSION__,
state		 = "installed",
info		 = _("The Su-25 'Grach' (Rook), NATO callsigned 'Frogfoot', is a dedicated strike attack aircraft designed for the close air support and anti-tank roles. The Su-25 has seen combat in several conflicts during its more than 25 years in service. The Su-25 combines excellent pilot protection and high speed compared to most dedicated attack aircraft. It can be armed with a variety of weapon systems including guided missiles, bombs, rockets, and its internal 30mm cannon."),

Skins	= 
	{
		{
			name	= _("Su-25"),
			dir		= "Skins/1"
		},
	},
Missions =
	{
		{
			name		    = _("Su-25"),
			dir			    = "Missions",
            training_ids    = {EN = 'SU-25A_video_EN', RU = 'SU-25A_video_RU',},
		},
	},
	
LogBook =
	{
		{
			name		= _("Su-25"),
			type		= "Su-25",
		},
	},
Options =
    {
        {
            name		= _("Su-25"),
            nameId		= "Su-25",
            dir			= "Options",
        },
    },  
	
InputProfiles =
{
    ["su-25"] = current_mod_path .. '/Input/su-25',
},

binaries 	 =
{
'SU25ACWS',
},


})
----------------------------------------------------------------------------------------
mount_vfs_texture_path  (current_mod_path ..  "/Cockpit/Textures/SU-25-CPT-TEXTURES")
mount_vfs_texture_path  (current_mod_path ..  "/Skins/1/ME")--for simulator loading window
mount_vfs_model_path    (current_mod_path ..  "/Cockpit/Shape")
mount_vfs_liveries_path (current_mod_path ..  "/Liveries")
MAC_flyable('Su-25'	, current_mod_path..'/Cockpit/KneeboardRight/', nil, current_mod_path..'/Comm/Su-25.lua')
----------------------------------------------------------------------------------------
plugin_done()
