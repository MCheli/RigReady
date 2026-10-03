local keyCommands = {
		{combos = {{key = 'F4', reformers = {'RCtrl'}}}, down = iCommandViewNextBookmark, name = _('Next camera bookmark'), category =  _('View')},
		{combos = {{key = 'M'}}, down = iCommandViewBookmarksMenu, name = _('Camera bookmarks menu bar'), category =  _('View')},
		{combos = {{key = 'B'}}, down = iCommandViewBookmarksEditor, name = _('Camera bookmarks editor'), category =  _('View')},
		-- WASDEQ keys
		{combos = {{key = 'W'}}, pressed = iCommandViewKeyW, up = iCommandViewKeyWStop, name = _('Forward key W'), category = _('View')},
		{combos = {{key = 'S'}}, pressed = iCommandViewKeyS, up = iCommandViewKeySStop, name = _('Backward key S'), category = _('View')},
		{combos = {{key = 'A'}}, pressed = iCommandViewKeyA, up = iCommandViewKeyAStop, name = _('Left key A'), category = _('View')},
		{combos = {{key = 'D'}}, pressed = iCommandViewKeyD, up = iCommandViewKeyDStop, name = _('Right key D'), category = _('View')},
		{combos = {{key = 'W', reformers = {'LShift'}}}, pressed = iCommandViewKeyLShiftW, up = iCommandViewKeyLShiftWStop, name = _('Fast forward key LShift-W'), category = _('View')},
		{combos = {{key = 'S', reformers = {'LShift'}}}, pressed = iCommandViewKeyLShiftS, up = iCommandViewKeyLShiftSStop, name = _('Fast backward key LShift-S'), category = _('View')},
		{combos = {{key = 'A', reformers = {'LShift'}}}, pressed = iCommandViewKeyLShiftA, up = iCommandViewKeyLShiftAStop, name = _('Fast left key LShift-A'), category = _('View')},
		{combos = {{key = 'D', reformers = {'LShift'}}}, pressed = iCommandViewKeyLShiftD, up = iCommandViewKeyLShiftDStop, name = _('Fast right key LShift-D'), category = _('View')},
		{combos = {{key = 'W', reformers = {'LCtrl'}}}, pressed = iCommandViewKeyLCtrlW, up = iCommandViewKeyLCtrlWStop, name = _('Slow forward key LCtrl-W'), category = _('View')},
		{combos = {{key = 'S', reformers = {'LCtrl'}}}, pressed = iCommandViewKeyLCtrlS, up = iCommandViewKeyLCtrlSStop, name = _('Slow backward key LCtrl-S'), category = _('View')},
		{combos = {{key = 'A', reformers = {'LCtrl'}}}, pressed = iCommandViewKeyLCtrlA, up = iCommandViewKeyLCtrlAStop, name = _('Slow left key LCtrl-A'), category = _('View')},
		{combos = {{key = 'D', reformers = {'LCtrl'}}}, pressed = iCommandViewKeyLCtrlD, up = iCommandViewKeyLCtrlDStop, name = _('Slow right key LCtrl-D'), category = _('View')},
		{combos = {{key = 'E'}}, pressed = iCommandViewCameraHeightUp, up = iCommandViewCameraHeightUpStop, name = _('Camera height up'), category = _('View')},
		{combos = {{key = 'E', reformers = {'LShift'}}}, pressed = iCommandViewCameraHeightUpFast, up = iCommandViewCameraHeightUpStop, name = _('Camera height up fast'), category = _('View')},
		{combos = {{key = 'E', reformers = {'LCtrl'}}}, pressed = iCommandViewCameraHeightUpSlow, up = iCommandViewCameraHeightUpStop, name = _('Camera height up slow'), category = _('View')},
		{combos = {{key = 'Q'}}, pressed = iCommandViewCameraHeightDown, up = iCommandViewCameraHeightDownStop, name = _('Camera height down'), category = _('View')},
		{combos = {{key = 'Q', reformers = {'LShift'}}}, pressed = iCommandViewCameraHeightDownFast, up = iCommandViewCameraHeightDownStop, name = _('Camera height down fast'), category = _('View')},
		{combos = {{key = 'Q', reformers = {'LCtrl'}}}, pressed = iCommandViewCameraHeightDownSlow, up = iCommandViewCameraHeightDownStop, name = _('Camera height down slow'), category = _('View')},
		-- WASDEQ keys throttle
		{combos = {{key = 'PageUp'}}, pressed = iCommandViewCameraSpeedUp, name = _('Camera keyboard speed increase'), category = _('View')},
		{combos = {{key = 'PageDown'}}, pressed = iCommandViewCameraSpeedDown, name = _('Camera keyboard speed decrease'), category = _('View')},
		{combos = {{key = 'End'}}, down = iCommandViewCameraSpeedDefault, name = _('Camera keyboard speed default'), category = _('View')},
		-- Camera roll keys
		{combos = {{key = '1'}}, pressed = iCommandViewCameraRollLeft, up = iCommandViewCameraRollLeftStop, name = _('Camera roll left'), category = _('View')},
		{combos = {{key = '3'}}, pressed = iCommandViewCameraRollRight, up = iCommandViewCameraRollRightStop, name = _('Camera roll right'), category = _('View')},
		{combos = {{key = '2'}}, down = iCommandViewCameraRollReset, name = _('Camera roll reset'), category = _('View')},
		-- rotation throttle
		{combos = {{key = '.'}}, pressed = iCommandViewCameraRotationSpeedUp, name = _('Camera rotation speed increase'), category = _('View')},
		{combos = {{key = ','}}, pressed = iCommandViewCameraRotationSpeedDown, name = _('Camera rotation speed decrease'), category = _('View')},
		{combos = {{key = '='}}, down = iCommandViewCameraRotationSpeedDefault, name = _('Camera rotation speed default'), category = _('View')},
}

return {
	keyCommands = keyCommands,
}
