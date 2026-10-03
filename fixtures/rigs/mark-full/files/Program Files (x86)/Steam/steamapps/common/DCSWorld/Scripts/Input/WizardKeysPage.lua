local DialogLoader	= require('DialogLoader'		)
local Input			= require('Input'				)
local InputUtils	= require('Input.Utils'			)
local WizardUtils	= require('Input.WizardUtils'	)
local i18n			= require('i18n'				)

local _ = i18n.ptranslate

-- Data
local commands_ = {
	{name = 'pitch_up', caption = _('Aircraft Pitch Down'), combo = WizardUtils.makeKeyCombo() },
	{name = 'pitch_down', caption = _('Aircraft Pitch Up'), combo = WizardUtils.makeKeyCombo() },
	{name = 'roll_left', caption = _('Aircraft Bank Left'), combo = WizardUtils.makeKeyCombo() },
	{name = 'roll_right', caption = _('Aircraft Bank Right'), combo = WizardUtils.makeKeyCombo() },
	{name = 'rudder_left', caption = _('Aircraft Rudder Left'), combo = WizardUtils.makeKeyCombo() },
	{name = 'rudder_right', caption = _('Aircraft Rudder Right'), combo = WizardUtils.makeKeyCombo() },
	{name = 'thrust_up', caption = _('Throttle Up'), combo = WizardUtils.makeKeyCombo() },
	{name = 'thrust_down', caption = _('Throttle Down'), combo = WizardUtils.makeKeyCombo() },
	{name = 'plane_trim_up', caption = _('Trim: Nose Up'), combo = WizardUtils.makeKeyCombo() },
	{name = 'plane_trim_down', caption = _('Trim: Nose Down'), combo = WizardUtils.makeKeyCombo() },
	{name = 'plane_trim_left', caption = _('Trim: Left Wing Down'), combo = WizardUtils.makeKeyCombo() },
	{name = 'plane_trim_right', caption = _('Trim: Right Wing Down'), combo = WizardUtils.makeKeyCombo() },
	{name = 'plane_gear', caption = _('Landing Gear Up/Down'), combo = WizardUtils.makeKeyCombo() },
	{name = 'plane_flaps_off', caption = _('Flaps Up'), combo = WizardUtils.makeKeyCombo() },
	{name = 'plane_flaps_on', caption = _('Flaps Landing Position'), combo = WizardUtils.makeKeyCombo() },
	{name = 'airbrake', caption = _('Airbrake'), combo = WizardUtils.makeKeyCombo() },
	{name = 'wheel_brake', caption = _('Wheel Brake - ON/OFF'), combo = WizardUtils.makeKeyCombo() },
	{name = 'left_wheel_brake', caption = _('Wheel Brake Left - ON/OFF'), combo = WizardUtils.makeKeyCombo() },
	{name = 'right_wheel_brake', caption = _('Wheel Brake Right - ON/OFF'), combo = WizardUtils.makeKeyCombo() },
	{name = 'plane_eject', caption = _('Eject (3 times)'), combo = WizardUtils.makeKeyCombo() },
	--Пока убрал из визарда, тк для большинства техники Air-to-Air имеет биндинг на '2', а Air-to-Ground имеет биндинг '7' не так как в общих
	--{name = 'plane_mode_nav', caption = _('(1) Navigation Modes'), combo = WizardUtils.makeKeyCombo() },
	--{name = 'plane_mode_ground', caption = _('(2) Air-to-Ground Modes'), combo = WizardUtils.makeKeyCombo() },
	--{name = 'plane_mode_bvr', caption = _('(3) Air-to-Air Modes'), combo = WizardUtils.makeKeyCombo() },
	{name = 'lock_aircraft', caption = _('Lock Target'), combo = WizardUtils.makeKeyCombo() },
	{name = 'unlock_target', caption = _('Unlock Target'), combo = WizardUtils.makeKeyCombo() },
	{name = 'plane_change_weapon', caption = _('Weapon Change'), combo = WizardUtils.makeKeyCombo() },
	{name = 'fire', caption = _('Weapon Fire'), combo = WizardUtils.makeKeyCombo() },
	{name = 'weapon_release_button', caption = _('Weapon Release Button'), combo = WizardUtils.makeKeyCombo() },
	{name = 'drop_countermeasures', caption = _('Countermeasures Release'), combo = WizardUtils.makeKeyCombo() },
	{name = 'electronic_countermeasures', caption = _('ECM'), combo = WizardUtils.makeKeyCombo() },
	{name = 'radio_menu', caption = _('Radio Menu'), combo = WizardUtils.makeKeyCombo() },
	{name = 'chat', caption = _('Multiplayer chat - mode All'), combo = WizardUtils.makeKeyCombo() },
}
local currCommand_ = 1
local pageSwitchedByInput = false

local cdata 	= {
	selectKeyDescription = _('Wizard.SelectKeyDescription'),
	continueTip = _('Wizard.KeyPageContinueTip')
}

-- Widgets
local panelMain_
local toggleButton_
local staticCaption_
local staticTooltip_

-- Functions
local getPanelMain
local selectCommand
local setComboFromSaveOrDefault
local resetCommandIndex
local resetCombos
local handleKey
local handleUpdate
local getCurrentCombo
local getCombos
local getCombosToSave
local onNext
local onPrevious
local getCommandsCount
local getCurrentCommandIndex
local resetFocusFromButtons

-- Implementation
function getPanelMain()
	local dialog = DialogLoader.spawnDialogFromFile('./Scripts/Input/WizardKeysPage.dlg', cdata)
	
	panelMain_ = dialog.panelMain
	panelMain_:setPosition(0, 0)
	toggleButton_ = panelMain_.toggleButton
	staticCaption_ = panelMain_.staticCaption
	staticTooltip_ = panelMain_.staticTooltip
	
	dialog:removeWidget(dialog.panelMain)
	dialog:kill()
	
	selectCommand()
	
	return panelMain_ 
end

function selectCommand()
	local command = commands_[currCommand_]
	
	staticCaption_:setText(cdata.selectKeyDescription .. " " .. command.caption)
	
	setComboFromSaveOrDefault(command)
	
	local updateTooltip = function()
		local command = commands_[currCommand_]
		local Wizard = require('Input.Wizard')
		local assingResult = Wizard.checkLastCombo()
		staticTooltip_:setVisible((command.combo.key and assingResult) and true or false)
	end
	
	WizardUtils.toggleButtonSetCallback(toggleButton_, command, function()
		staticTooltip_:setVisible(false)
		local Wizard = require('Input.Wizard')
		Wizard.checkLastCombo()
		resetFocusFromButtons()
	end
	, function()
		updateTooltip()
		resetFocusFromButtons()
	end)	
	WizardUtils.initToggleButtonState(toggleButton_, command)
	updateTooltip()
end

function setComboFromSaveOrDefault(command)
	if command.combo.key ~= nil then
		return
	end
	
	command.combo = WizardUtils.getWizardComboFromSave(command.name)
end

function resetCommandIndex()
	currCommand_ = 1
end

function resetCombos()
	for i, command in ipairs(commands_) do
		command.combo = WizardUtils.makeKeyCombo()
	end
end

function handleKey(name, deviceId, isModifier)
	if pageSwitchedByInput == true then
		return
	end
	
	local command = commands_[currCommand_]
	
	if toggleButton_:getState() then
		if isModifier then
			WizardUtils.setComboReformerName(command.combo, name)
			toggleButton_:setText(WizardUtils.getComboString(command.combo))
		else
			if WizardUtils.toggleButtonHandleKey(toggleButton_, command.combo, name, deviceId, isModifier) then
				local Wizard = require('Input.Wizard')
				local assingResult = Wizard.checkLastCombo()
				staticTooltip_:setVisible(assingResult)
			end
		end
	else
		if pageSwitchedByInput ~= true and command.combo.key == name and deviceId == command.combo.deviceId then
			pageSwitchedByInput = true
			local Wizard = require('Input.Wizard')
			Wizard.selectNextPage();
		end
	end
end

function handleUpdate()
	local inputActions = Input.getInputActions()
	if #inputActions == 0 and pageSwitchedByInput == true then
		pageSwitchedByInput = false
	end
end

function getCurrentCombo()
	local command =  commands_[currCommand_]
	local combos = {}
	combos[command.name] = {combo = command.combo, caption = command.caption}
	
	return combos
end

function getCombos()
	local combos = {}
	
	for i, command in ipairs(commands_) do
		combos[command.name] = {combo = command.combo, caption = command.caption}
	end
	
	return combos
end

function getCombosToSave()
	local combos = {}
	
	for i, command in ipairs(commands_) do
		combos[command.name] = command.combo
	end

	return combos
end

function onNext()
	-- to next command
	local result = false -- return true if handle
	local Wizard = require('Input.Wizard')
	
	if Wizard.checkLastCombo() then
		if currCommand_ + 1 <= #commands_ then
			currCommand_ = currCommand_ + 1
			selectCommand()
			result = true
		end
	end

	return result 
end

function onPrevious()
	local result = false
	
	if currCommand_ - 1 > 0 then
		currCommand_ = currCommand_ - 1
		selectCommand()
		result = true
	end

	return result 
end

function getCommandsCount()
	return #commands_
end

function getCurrentCommandIndex()
	return currCommand_
end

function resetFocusFromButtons()
	toggleButton_:setFocused(false)
end

return {
	getPanelMain = getPanelMain,
	resetCommandIndex = resetCommandIndex,
	resetCombos = resetCombos,
	handleKey = handleKey,
	handleUpdate = handleUpdate,
	getCurrentCombo = getCurrentCombo,
	getCombos = getCombos,
	getCombosToSave	= getCombosToSave,
	onNext = onNext,
	onPrevious = onPrevious,
	getCommandsCount = getCommandsCount,
	getCurrentCommandIndex = getCurrentCommandIndex,
	resetFocusFromButtons = resetFocusFromButtons,
}