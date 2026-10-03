local DialogLoader	= require('DialogLoader')
local Input 		= require('Input'		)
local InputUtils 	= require('Input.Utils'	)
local i18n			= require('i18n'		)

local _ = i18n.ptranslate

-- Data
local cdata = {
	continueTip = _('Wizard.InfoPageContinueTip'),
}
local anyButtonContinueFlag = false
local pageSwitchedByInput = false

-- Widgets
local panelMain_
local staticTooltip_

-- Functions
local getPanelMain
local setDescription
local setAnyButtonContinueEnabled

-- Implementation
function getPanelMain()
	local dialog = DialogLoader.spawnDialogFromFile('./Scripts/Input/WizardInfoPage.dlg', cdata)
	
	panelMain_ = dialog.panelMain
	panelMain_:setPosition(0, 0)
	staticTooltip_ = panelMain_.staticTooltip
	
	dialog:removeWidget(dialog.panelMain)
	dialog:kill()
	
	setAnyButtonContinueEnabled(false)
	
	return panelMain_ 
end

function setDescription(text)
	local staticText_ = panelMain_.staticText
	if staticText_ and text then
		staticText_:setText(text)
	end
end

function setAnyButtonContinueEnabled(isEnable)
	anyButtonContinueFlag = isEnable
	if staticTooltip_ then
		staticTooltip_:setVisible(anyButtonContinueFlag)
	end
end

function handleKey(name, deviceId, isModifier)
	if not anyButtonContinueFlag then
		return
	end
	
	if pageSwitchedByInput ~= true and InputUtils.getDeviceNameById(deviceId) ~= "Mouse" then
		pageSwitchedByInput = true
		local Wizard = require('Input.Wizard')
		Wizard.selectNextPage();
	end
end

function handleUpdate()
	if not anyButtonContinueFlag then
		return
	end
	
	local inputActions = Input.getInputActions()
	if #inputActions == 0 and pageSwitchedByInput == true then
		pageSwitchedByInput = false
	end
end

return {
	getPanelMain = getPanelMain,
	setDescription = setDescription,
	setAnyButtonContinueEnabled = setAnyButtonContinueEnabled,
	handleKey = handleKey,
	handleUpdate = handleUpdate,
}