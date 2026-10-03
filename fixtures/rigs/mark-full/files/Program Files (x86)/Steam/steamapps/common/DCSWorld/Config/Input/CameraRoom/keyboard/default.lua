return {
	keyCommands = {
		{combos = {{key = 'O'}}, down = iCommandViewPieMenu, name = _('Pie menu'), category = _('View')},
		{combos = {{key = 'I'}}, down = iCommandViewInputControlToggle, name = _('Input control toggle'), category = _('View')},
		{combos = {{key = 'H', reformers = {'LAlt'}}}, down = iCommandViewCameraMoveHorizontal, name = _('Horizontal camera moving'), category = _('View')},
		{combos = {{key = 'V', reformers = {'LAlt'}}}, down = iCommandViewCameraMoveVertical, name = _('Vertical camera moving'), category = _('View')},
		{combos = {{key = 'F', reformers = {'LAlt'}}}, down = iCommandViewCameraMoveFrontal, name = _('Frontal camera moving'), category = _('View')},
		{combos = {{key = 'G', reformers = {'LAlt'}}}, down = iCommandViewAtGround, name = _('Direct the camera towards the ground'), category = _('View')},
		{combos = {{key = 'N', reformers = {'LAlt'}}}, down = iCommandViewCameraMoveAlongTheWalls, name = _('Direct the camera along the room walls'), category = _('View')},		
	},
}
