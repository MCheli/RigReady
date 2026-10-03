local keyCommands = 
{
	-- Carrier
	{combos = {{key = 'S', reformers = {'LShift','LCtrl', 'LAlt'}}},	down = iCommandPilotGestureSalute,				name = _('Pilot Salute'),				category = _('Supercarrier')},
	{combos = {{key = 'P', reformers = {'LShift','LCtrl', 'LAlt'}}},	down = iCommandCarrierParkingMenu,				name = _('Carrier Parking Menu'),		category = _('Supercarrier')},
	{combos = {{key = 'T', reformers = {'LShift','LCtrl', 'LAlt'}}},	down = iCommandCarrierTeleportToParking,		name = _('Carrier Teleport To Parking'),category = _('Supercarrier')},
	{combos = {{key = 'H', reformers = {'LShift','LCtrl', 'LAlt'}}},	down = iCommandCarrierSwitchHelpersDisplay,		name = _('Carrier Helpers Toggle'),		category = _('Supercarrier')},
	{combos = {{key = 'M', reformers = {'LShift','LCtrl', 'LAlt'}}},	down = iCommandCarrierSwitchMessagesDisplay,	name = _('Carrier Messages Toggle'),	category = _('Supercarrier')},
}

return 
{
	keyCommands = keyCommands,
}
