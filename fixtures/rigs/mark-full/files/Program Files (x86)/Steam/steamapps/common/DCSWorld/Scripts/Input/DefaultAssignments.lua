-- this is used to find initial assignment  for joystick  with   defaultDeviceAssignmentFor in cases  when  diff file  is not provided by module 
local default_assignments = {
	["default"] = 
	{
		pitch = 'JOY_Y',
		roll = 'JOY_X',
		rudder = 'JOY_RZ',
		thrust = 'JOY_Z',
		fire = 'JOY_BTN1',
	}
}

local IGNORE_FFB = {
	ignore = true,
}

local function INVERTED(key_)
	return
	{
		key		= key_,
		filter	= 
		{
			curvature 	= {0},
			deadzone  	= 0,
			invert 		= true,
			saturationX = 1,
			saturationY = 1,
			slider 		= false,
		},
	}
end


default_assignments["Keyboard"] = 
{
	pitch_up 					= {key = 'Up'},
	pitch_down 					= {key = 'Down'},
	roll_left 					= {key = 'Left'},
	roll_right 					= {key = 'Right'},
	rudder_left 				= {key = 'Z'},
	rudder_right 				= {key = 'X'},
	thrust_up 					= {key = 'Num+'},
	thrust_down 				= {key = 'Num-'},
	plane_trim_up 				= {key = '.', reformers = {'RCtrl'}},
	plane_trim_down 			= {key = ';', reformers = {'RCtrl'}},
	plane_trim_left 			= {key = ',', reformers = {'RCtrl'}},
	plane_trim_right 			= {key = '/', reformers = {'RCtrl'}},
	plane_gear 					= {key = 'G'},
	plane_flaps_off 			= {key = 'F', reformers = {'LCtrl'}},
	plane_flaps_on 				= {key = 'F', reformers = {'LShift'}},
	airbrake 					= {key = 'B'},
	wheel_brake 				= {key = 'W'},
	left_wheel_brake 			= {key = 'W', reformers = {'LCtrl'}},
	right_wheel_brake 			= {key = 'W', reformers = {'LAlt'}},
	plane_eject 				= {key = 'E', reformers = {'LCtrl'}},
	plane_mode_nav 				= {key = '1'},
	plane_mode_bvr 				= {key = '2'},
	plane_mode_ground 			= {key = '7'},
	lock_aircraft 				= {key = 'Enter'},    
	unlock_target 				= {key = 'Back'},
	plane_change_weapon 		= {key = 'D'},
	fire 						= {key = 'Space'},
	weapon_release_button 		= {key = 'Space', reformers = {'RAlt'}},
	drop_countermeasures 		= {key = 'Q'},
	electronic_countermeasures 	= {key = 'E'},
	radio_menu 					= {key = '\\'},
	chat 						= {key = 'Tab'},
}

default_assignments["CH PRO PEDALS USB "] = --note space on the end , it comes from vendor
{
	rudder	= 'JOY_Z',
	FFB 	= IGNORE_FFB,
}

default_assignments["CH PRO THROTTLE USB "] = --note space on the end , it comes from vendor
{
	thrust	= 'JOY_Z',
	FFB 	= IGNORE_FFB,
}

default_assignments	["Defender COBRA M5 USB Joystick"] = 
{
	thrust	= 'JOY_SLIDER1',
	pitch	= 'JOY_Y',
	roll	= 'JOY_X',
	rudder	= 'JOY_RZ',
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}

default_assignments	["Saitek Pro Flight X-55 Rhino Stick"] =
{
	pitch	= 'JOY_Y',
	roll	= 'JOY_X',
	rudder	= 'JOY_RZ',
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}

default_assignments	["Saitek Pro Flight X-55 Rhino Throttle"] = 
{
	thrust		 = 'JOY_X',
	thrust_left	 = 'JOY_X',
	thrust_right = 'JOY_Y',
	FFB 		 = IGNORE_FFB,
}

default_assignments	["VKBsim Black Box "] = --note space on the end , it comes from vendor
{
	rudder	= 'JOY_RX',
	FFB 	= IGNORE_FFB,
}

default_assignments	["VKBsim Gladiator "] = --note space on the end , it comes from vendor
{
	pitch	= 'JOY_Y',
	roll	= 'JOY_X',
	thrust  = INVERTED("JOY_Z"),
	FFB 	= IGNORE_FFB,
}

default_assignments	["SideWinder Force Feedback 2 Joystick"] = 
{ 
	thrust	= 'JOY_SLIDER1',
	pitch	= 'JOY_Y',
	roll	= 'JOY_X',
	rudder	= 'JOY_RZ',
	fire	= 'JOY_BTN1',

	FFB 	= 
	{
		trimmer 	= 1.0,
		shake 		= 0.5,
		swapAxes 	= true,
		invertX 	= false,
		invertY 	= false,
	}
}

default_assignments	["R-VPC Stick MT-50CM2"] = 
{
	pitch	= 'JOY_Y',
	roll	= 'JOY_X',
	rudder	= 'JOY_Z',
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}

default_assignments	["L-VPC Throttle MT-50CM3"] = 
{
	thrust		 = INVERTED('JOY_RX'),
	thrust_left	 = INVERTED('JOY_RX'),
	thrust_right = INVERTED('JOY_RY'),
	FFB 		 = IGNORE_FFB,
}

default_assignments	["Throttle - HOTAS Warthog"] = 
{
	thrust		 = "JOY_RZ",
	thrust_left  = "JOY_RZ",
	thrust_right = "JOY_Z",	
	FFB 		 = IGNORE_FFB,
}

default_assignments	["Joystick - HOTAS Warthog"] =
{
	pitch	= 'JOY_Y',
	roll	= 'JOY_X',
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}


default_assignments["VPC-Throttle"]				  = default_assignments["L-VPC Throttle MT-50CM3"]
default_assignments["VPC Throttle MT-50CM3"]	  = default_assignments["L-VPC Throttle MT-50CM3"]
default_assignments["LEFT VPC Throttle MT-50CM3"] = default_assignments["L-VPC Throttle MT-50CM3"]

default_assignments["RIGHT VPC Stick MT-50CM2"]   = default_assignments["R-VPC Stick MT-50CM2"]
default_assignments["RIGHT VPC Stick WarBRD"]	  = default_assignments["R-VPC Stick MT-50CM2"]
default_assignments["VPC WarBRD + MT50"]		  = default_assignments["R-VPC Stick MT-50CM2"]

default_assignments["VPC Rudder Pedals"] =
{
	rudder  = "JOY_Z",
	FFB 	= IGNORE_FFB,
}

default_assignments["Bravo Throttle Quadrant"] =
{
	thrust		 = INVERTED('JOY_X'),
	thrust_left	 = INVERTED('JOY_X'),
	thrust_right = INVERTED('JOY_RZ'),
	FFB 		= IGNORE_FFB,
}

-- Additions below -------------------------------------------------------------------------------------------------------
default_assignments[" VKBsim T-Rudder "]	=  default_assignments["VKBsim Black Box "] 
default_assignments["CH Pro Pedals USB"]  	= default_assignments["CH PRO PEDALS USB "]

default_assignments	["VKBSim Gladiator NXT R "] = --note space on the end , it comes from vendor
{
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	FFB 	= IGNORE_FFB,
}

default_assignments	["T.16000M"] = 
{
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	rudder	= 'JOY_RZ',
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}

default_assignments	["TWCS Throttle"] = 
{
	thrust	= 'JOY_Z',
	rudder	= 'JOY_SLIDER2',
	FFB 	= IGNORE_FFB,
}

default_assignments	["Logitech Extreme 3D"] = 
{
	thrust	= 'JOY_SLIDER1',
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	rudder	= 'JOY_RZ',
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}

default_assignments	["Saitek X52 Pro Flight Control System"] = 
{
	thrust	= 'JOY_Z',
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	rudder	= 'JOY_RZ',
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}

default_assignments	["Saitek Pro Flight X-56 Rhino Stick"] = 
{
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	rudder	= 'JOY_RZ',
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}

default_assignments	["Saitek Pro Flight X-56 Rhino Throttle"] = 
{
	thrust		 = 'JOY_X',
	thrust_left	 = 'JOY_X',
	thrust_right = 'JOY_Y',
	FFB 	= IGNORE_FFB,
}

default_assignments	["Logitech G940 Joystick"] = 
{
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	fire	= 'JOY_BTN1',
}

default_assignments	["Logitech G940 Throttle"] = 
{
	thrust		 = 'JOY_X',
	thrust_left	 = 'JOY_Y',
	thrust_right = 'JOY_X',
	FFB 	= IGNORE_FFB,
}

default_assignments	["Logitech G940 Pedals"] = 
{
	rudder				= 'JOY_RZ',
	left_wheel_brake	= 'JOY_X',
	right_wheel_brake	= 'JOY_Y',
	FFB 	= IGNORE_FFB,
}

default_assignments	[" VKB-Sim Space Gladiator "] =  --note space before and after , it comes from vendor
{
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}

default_assignments	["EVO BASE Mk.I RIGHT"] = 
{
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	fire	= 'JOY_BTN1',
	FFB 	= IGNORE_FFB,
}

default_assignments	["T-Pendular-Rudder"] = 
{
	rudder				= 'JOY_Z',
	left_wheel_brake	= 'JOY_Y',
	right_wheel_brake	= 'JOY_X',
	FFB 	= IGNORE_FFB,
}

default_assignments	["MFG Crosswind V2"] = 
{
	rudder				= 'JOY_RZ',
	left_wheel_brake	= INVERTED('JOY_X'),
	right_wheel_brake	= INVERTED('JOY_Y'),
	FFB 	= IGNORE_FFB,
}

default_assignments	["WINWING Orion Joystick Base 2 + JGRIP-F16"] = 
{
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	FFB 	= IGNORE_FFB,
}

default_assignments	["WINWING Orion Throttle Base II + F15EX HANDLE L + F15EX HANDLE R"] = 
{
	thrust		 = 'JOY_RY',
	thrust_left	 = 'JOY_RY',
	thrust_right = 'JOY_RX',
	FFB 	= IGNORE_FFB,
}

default_assignments	["WINWING Orion Throttle Base II + F15EX HANDLE L + F15 HANDLE R"] = 
{
	thrust		 = 'JOY_RY',
	thrust_left	 = 'JOY_RY',
	thrust_right = 'JOY_RX',
	FFB 	= IGNORE_FFB,
}

default_assignments	["WINWING Orion Throttle Base II + TGRIP-F16"] = 
{
	thrust		 = 'JOY_RY',
	thrust_left	 = 'JOY_RY',
	thrust_right = 'JOY_RX',
	FFB 	= IGNORE_FFB,
}

default_assignments	["WINWING Orion Throttle Base II + F18 HANDLE"] = 
{
	thrust		 = 'JOY_RY',
	thrust_left	 = 'JOY_RY',
	thrust_right = 'JOY_RX',
	FFB 		= IGNORE_FFB,
}

default_assignments	["WINWING SKYWALKER Metal Rudder Pedals"] = 
{
	left_wheel_brake	= INVERTED('JOY_RY'),
	right_wheel_brake	= INVERTED('JOY_RX'),
	rudder 				= 'JOY_RZ',
	FFB 				= IGNORE_FFB,
}

--with MH16
default_assignments	["MOZA AB9 FFB Base"] =
{
	roll	= "JOY_X",
	pitch	= "JOY_Y",
	fire	= 'JOY_BTN6',
	FFB		= 
	{
		trimmer 	= 1.0,
		shake 		= 0.5,
		swapAxes 	= false,
		invertX 	= false,
		invertY 	= false,
	}
}

default_assignments	["MOZA MRP Rudder Pedals"] =
{
	left_wheel_brake	= INVERTED('JOY_RY'),
	right_wheel_brake	= INVERTED('JOY_RX'),
	rudder 				= 'JOY_RZ',
	FFB 				= IGNORE_FFB,
}

default_assignments	["MOZA MTP Throttle Panel"] =
{
	thrust			= INVERTED('JOY_RX'),
	thrust_left		= INVERTED('JOY_RX'),
	thrust_right	= INVERTED('JOY_RY'),
	FFB 			= IGNORE_FFB,
}

default_assignments[" VKBSim Gladiator NXT R "]  								= default_assignments["VKBSim Gladiator NXT R "]
default_assignments[" VKB-Sim Gladiator NXT R  "]   							= default_assignments["VKBSim Gladiator NXT R "]
default_assignments["X52 H.O.T.A.S."]  											= default_assignments["Saitek X52 Pro Flight Control System"]
default_assignments["X56 H.O.T.A.S. Stick"]   									= default_assignments["Saitek Pro Flight X-56 Rhino Stick"]
default_assignments["X56 H.O.T.A.S. Throttle"]   								= default_assignments["Saitek Pro Flight X-56 Rhino Throttle"]
default_assignments["WINWING JOYSTICK BASE2 + JGRIP-F16"]   					= default_assignments["WINWING Orion Joystick Base 2 + JGRIP-F16"]
default_assignments["WINWING THROTTLE BASE2 + F15EX HANDLE L + F15EX HANDLE R"] = default_assignments["WINWING Orion Throttle Base II + F15EX HANDLE L + F15EX HANDLE R"]
default_assignments["WINWING THROTTLE BASE2 + F15EX HANDLE L + F15 HANDLE R"]   = default_assignments["WINWING Orion Throttle Base II + F15EX HANDLE L + F15 HANDLE R"]
default_assignments["WINWING THROTTLE BASE2 + TGRIP-F16"]   					= default_assignments["WINWING Orion Throttle Base II + TGRIP-F16"]
default_assignments["WINWING THROTTLE BASE2 + F18 HANDLE"]   					= default_assignments["WINWING Orion Throttle Base II + F18 HANDLE"]

--no default assignments for panels
local AUX_PANEL_DEFAULT =  { FFB = IGNORE_FFB }
default_assignments	["WINWING ICP"] 					= AUX_PANEL_DEFAULT
default_assignments	["WINWING MFD1-C"] 					= AUX_PANEL_DEFAULT
default_assignments	["WINWING MFD1-L"] 					= AUX_PANEL_DEFAULT
default_assignments	["WINWING MFD1-R"] 					= AUX_PANEL_DEFAULT
default_assignments	["WINWING F18 COMBAT READY PANEL"] 	= AUX_PANEL_DEFAULT
default_assignments	["WINWING F18 TAKEOFF PANEL"] 		= AUX_PANEL_DEFAULT
default_assignments	["WINWING F18 TAKEOFF PANEL 2"] 	= AUX_PANEL_DEFAULT
default_assignments	["WINWING UFC1"] 					= AUX_PANEL_DEFAULT
default_assignments	["WINWING UFC1 + HUD1"] 			= AUX_PANEL_DEFAULT
default_assignments	["F16 MFD 1"]						= AUX_PANEL_DEFAULT
default_assignments	["F16 MFD 2"]						= AUX_PANEL_DEFAULT
default_assignments	["F16 MFD 3"]						= AUX_PANEL_DEFAULT
default_assignments	["F16 MFD 4"]						= AUX_PANEL_DEFAULT
default_assignments	["F16 MFD 5"]						= AUX_PANEL_DEFAULT
default_assignments	["F16 MFD 6"]						= AUX_PANEL_DEFAULT
default_assignments	["Total Controls MFBB"] 			= AUX_PANEL_DEFAULT
default_assignments	["TC MFBB"] 						= AUX_PANEL_DEFAULT
default_assignments	["Logitech G13 Joystick"] 			= AUX_PANEL_DEFAULT
default_assignments	["Joystick (Razer Tartarus Pro)"] 	= AUX_PANEL_DEFAULT
default_assignments	["Joystick (Razer Tartarus V2)"] 	= AUX_PANEL_DEFAULT
default_assignments	["Razer Tartarus Chroma"] 			= AUX_PANEL_DEFAULT
default_assignments	["RIGHT VPC Panel #1"] 				= AUX_PANEL_DEFAULT
default_assignments	["LEFT VPC Panel #2"] 				= AUX_PANEL_DEFAULT
default_assignments	["RIGHT VPC Control Panel 3"] 		= AUX_PANEL_DEFAULT
default_assignments	["LEFT VPC SharKa-50 Panel"] 		= AUX_PANEL_DEFAULT
default_assignments	["TEDAC Right Grip"] 				= AUX_PANEL_DEFAULT
default_assignments	["TEDAC Left Grip"] 				= AUX_PANEL_DEFAULT
default_assignments	["MOZA MTLP Take-off Landing Pane"] = AUX_PANEL_DEFAULT

return default_assignments
