--/N/ 03. MAY 2018.

local self_ID = "Christen Eagle II by Magnitude 3 LLC"

declare_plugin(self_ID,
{
	installed 	= true, -- if false that will be place holder, or advertising
	dirName	= current_mod_path,
	displayName = _("Christen Eagle II"),
	fileMenuName = _("Christen Eagle II"),
	update_id        = "MAGNITUDE3_CHRISTEN_EAGLE-II",
--steam_appid      = xxxxxx,
--registryPath    = "Leatherneck Simulations\\CE2",
--DRM_controller   = "bin/xxxxxxxx.exe",
	version		= __DCS_VERSION__,--"demo",	
	state			= "installed",
	info		 	= _("\n The Christen Eagle II, which later became the Aviat Eagle II in the mid-1990s, is an aerobatic sporting biplane aircraft that has been produced in the United States since February 1977. It was designed in 1976 by a P-51 Mustang pilot and aerobatic competitor Frank Christensen. For pure flying excitement and adventure, you'll find an Eagle hard to beat, while being well within the capability of most competent tailwheel pilots. The fully inverted fuel and oil systems make all of this stuff child's play. \n Flight Review: The Enduring Eagle \n by Bob Grimstead \n\n I used to regard the Eagle as a substandard Pitts, but I was wrong. The 200-horsepower Eagle outperforms any 200-hp two-place Pitts, and its cleaner airframe is roomier, more comfortable, more affordable, better finished and has superior visibility in addition to being easier to control. As an aerobatic two-place biplane, the Eagle's ability is surpassed only by the six-cylinder Pitts S-2B with nearly 50% more power (but lower G limits)."),
--developerName	= _("Magnitude 3 LLC"),
	

	binaries =
		{
			'CE2_FlightModel', 
			'CE2_Avionics'
		},
	
	Skins	= -- za editor misija
		{
			{
				name	= _("Christen Eagle II"),
				dir		= "Skins/1"
			},
		},
		
	Missions = -- misije i kampanje
		{
			{
				name		= _("Christen Eagle II"),
				dir			= "Missions",
			},
		},
	
	LogBook =
		{
			{
				name	= _("Christen Eagle II"),
				type		= "Christen Eagle II",
			},
		},
		
	Options =
	{
		{
			name		= _("Christen Eagle II"),
			nameId		= "Christen Eagle II",
			dir			= "Options",
		},
	},
		
	-- collection of input profiles 
	InputProfiles =
		{
			["Christen Eagle II"] = current_mod_path .. '/Input',			
		},
		
})
---------------------------------------------------------------------------------------
--mounting 3d model / liveries / textures paths 
mount_vfs_texture_path	(current_mod_path.."/Skins/1/ME") --/N/ must...
mount_vfs_model_path	(current_mod_path.."/Shapes")
mount_vfs_liveries_path	(current_mod_path.."/Liveries")
mount_vfs_texture_path	(current_mod_path.."/Textures")
mount_vfs_texture_path	(current_mod_path.."/Textures/PBR")
mount_vfs_texture_path	(current_mod_path.."/Textures/Avionics")

dofile(current_mod_path..'/Entry/Suspension_CE2.lua')
dofile(current_mod_path.."/Entry/Views.lua")


local FM = {
	self_ID, 
	'CE2_FlightModel',
	old = false,
	--Ako je dodavanje mase (npr. gorivo, dim) uradjeno u FM, centar mase se odnosi na prazan avion sa oba pilota, provereno (15. aug 2017).
	--Nazalost, sve misije sacuvane pre izmene pamte staru poziciju CoG (utvrdjeno 17. aug 2017). To znaci da ako se CoG menja ovde, treba preraditi sve misije... ME cuva poziciju starog CoG - ako se promeni CoG sve misije moraju da se naprave ponovo.
	
	--center_of_mass = {0.0, 0.0, 0.0},
	center_of_mass = {-0.04, -0.05, 0.0},
	--moment_of_inertia =  {1000, 3000, 2100},
	moment_of_inertia =  {1300, 2500, 1400},
	
	suspension = suspension,
}

make_view_settings('Christen Eagle II', ViewSettings, SnapViews)
make_flyable('Christen Eagle II',current_mod_path..'/Cockpit/',FM,current_mod_path..'/comm.lua')
set_manual_path('Christen Eagle II', current_mod_path .. '/Doc')

plugin_done() -- finish declaration , clear temporal data
