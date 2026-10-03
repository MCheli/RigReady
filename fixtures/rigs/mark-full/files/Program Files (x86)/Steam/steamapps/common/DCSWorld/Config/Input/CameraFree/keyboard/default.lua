return {
	keyCommands = {
		{combos = {{key = 'H', reformers = {'LAlt'}}}, down = iCommandViewCameraMoveHorizontal, name = _('Horizontal camera moving'), category = _('View')},
		{combos = {{key = 'V', reformers = {'LAlt'}}}, down = iCommandViewCameraMoveVertical, name = _('Vertical camera moving'), category = _('View')},
		{combos = {{key = 'F', reformers = {'LAlt'}}}, down = iCommandViewCameraMoveFrontal, name = _('Frontal camera moving'), category = _('View')},
		{combos = {{key = 'G', reformers = {'LAlt'}}}, down = iCommandViewAtGround, name = _('Direct the camera towards the ground'), category = _('View')},
		{combos = {{key = 'N', reformers = {'LAlt'}}}, down = iCommandViewCameraWorldAxes, name = _('Direct the camera along world axes'), category = _('View')},
		-- Camera position to/from clipboard 
		{combos = {{key = 'C', reformers = {'LShift'}}}, down = iCommandViewCameraToClipboard, name = _('Unload camera position to clipboard'), category = _('View')},
		{combos = {{key = 'V', reformers = {'LShift'}}}, down = iCommandViewClipboardToCamera, name = _('Load camera position from clipboard'), category = _('View')},
	},
}
