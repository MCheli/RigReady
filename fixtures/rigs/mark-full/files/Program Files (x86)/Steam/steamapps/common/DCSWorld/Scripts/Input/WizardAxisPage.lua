local DialogLoader		= require('DialogLoader'			)
local AxesTuneWidget	= require('AxesTuneWidget'			)
local WizardUtils		= require('Input.WizardUtils'		)
local Input 			= require('Input'					)
local InputUtils 		= require('Input.Utils'				)
local StickTestWidget 	= require('Input.StickTestWidget'	)
local UpdateManager		= require('UpdateManager'			)
local SkinUtils 		= require('SkinUtils'				)
local i18n				= require('i18n'					)

local _ = i18n.ptranslate

-- Constants
local cdata = {
	selectAxisDescription = _('Wizard.SelectAxisDescription'),
	continueTip = _('Wizard.AxisPageContinueTip'),
	deadZone = _('Deadzone'),
	slider = _('Slider'),
	curvature = _('Curvature'),
	invert = _('Invert'),
}
local kInputAxesDeadzone = 0.03
local kInputAxesCurvature = 0.15

-- Data
local commands_ = {
	{
		description = _('Wizard.PitchDescription'),
		commandIconPath = 'dxgui\\skins\\skinme\\images\\window\\wizard\\pitch.png',
		name = 'pitch', caption = _('Pitch'), combo = WizardUtils.makeKeyCombo(), isAxis = true
	},
	{
		description = _('Wizard.RollDescription'),
		commandIconPath = 'dxgui\\skins\\skinme\\images\\window\\wizard\\roll.png',
		name = 'roll', caption = _('Roll'), combo = WizardUtils.makeKeyCombo(), isAxis = true
	},
	{
		description = _('Wizard.RudderDescription'),
		commandIconPath = 'dxgui\\skins\\skinme\\images\\window\\wizard\\yaw.png',
		name = 'rudder', caption = _('Rudder'), combo = WizardUtils.makeKeyCombo(), isAxis = true
	},
	{
		description = _('Wizard.ThrustDescription'),
		commandIconPath = '',
		name = 'thrust', caption = _('Thrust'), combo = WizardUtils.makeKeyCombo(), isAxis = true, isSlider = true
	}
}

local currCommand_ = 1
local pageSwitchedByInput = false

-- Widgets
local panelMain_
local toggleButtonAxis_
local staticDesc_
local staticCaption_
local staticTooltip_
local staticCommandIcon_
local sliderDeadzode_ 
local sliderCurvature_
local editBoxDeadzone_ 
local editBoxCurvature_
local checkBoxSlider_
local axesTuneWidget_

-- Functions
local getPanelMain
local selectCommand
local resetCommandIndex
local resetCombos
local handleKey
local handleAxis
local handleUpdate
local setDeadzone
local setCurvature
local setIsSlider
local setInvert
local updateStickWidgetData
local bindSliderAndEditBox
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
	local dialog = DialogLoader.spawnDialogFromFile('./Scripts/Input/WizardAxisPage.dlg', cdata)
	
	panelMain_ = dialog.panelMain
	toggleButtonAxis_ = panelMain_.toggleButtonAxis
	staticDesc_ = panelMain_.staticDesc
	staticCaption_ = panelMain_.staticCaption
	staticTooltip_ = panelMain_.staticTooltip
	staticCommandIcon_ = panelMain_.staticCommandIcon
	
	local panelSliders_ = panelMain_.panelSliders
	if panelSliders_ then
		sliderDeadzode_	= panelSliders_.sliderDeadzode
		editBoxDeadzone_ = panelSliders_.editBoxDeadzone
		bindSliderAndEditBox(sliderDeadzode_, editBoxDeadzone_, setDeadzone)
	
		sliderCurvature_ = panelSliders_.sliderCurvature
		editBoxCurvature_ = panelSliders_.editBoxCurvature
		bindSliderAndEditBox(sliderCurvature_, editBoxCurvature_, setCurvature)
	
		checkBoxSlider_ = panelSliders_.checkBoxSlider
		if checkBoxSlider_ ~= nil then
			checkBoxSlider_:addChangeCallback(function()
				setIsSlider(checkBoxSlider_:getState())
			end)
		end
		
		checkBoxInvert_ = panelSliders_.checkBoxInvert
		if checkBoxInvert_ ~= nil then
			checkBoxInvert_:addChangeCallback(function()
				setInvert(checkBoxInvert_:getState())
			end)
		end
	end
	
	axesTuneWidget_ = AxesTuneWidget.new()
	axesTuneWidget_:setBounds(panelMain_.staticAxisTuneWidgetPlaceholder:getBounds())
	axesTuneWidget_:setInRange(1)
	axesTuneWidget_:setOutRange(1)
	panelMain_:insertWidget(axesTuneWidget_)
	
	local stickWidget = StickTestWidget.getPanel()
	if stickWidget then
		stickWidget:setBounds(panelMain_.stickWidgetPlaceholder:getBounds())
		panelMain_:insertWidget(stickWidget)
		panelMain_.stickWidgetPlaceholder:destroy()
	end
	
	dialog:removeWidget(dialog.panelMain)
	dialog:kill()
	
	panelMain_:setPosition(0, 0)
	
	selectCommand()
	
	return panelMain_ 
end

function selectCommand()
	local command = commands_[currCommand_]
	
	staticCaption_:setText(cdata.selectAxisDescription .. " " .. command.caption)
	staticDesc_:setText(command.description)
	staticCommandIcon_:setSkin(SkinUtils.setStaticPicture(command.commandIconPath, staticCommandIcon_:getSkin()))
	
	setComboFromSaveOrDefault(command)
	
	setDeadzone(command.combo.deadzone or kInputAxesDeadzone)
	setCurvature(command.combo.curvature and command.combo.curvature[1] or kInputAxesCurvature)
	setIsSlider(command.combo.isSlider or command.isSlider or false)
	setInvert(command.combo.invert or command.invert or false)
	
	local updateTooltip = function()
		local command = commands_[currCommand_]
		local Wizard = require('Input.Wizard')
		local assingResult = Wizard.checkLastCombo()
		staticTooltip_:setVisible((command.combo.key and assingResult) and true or false)
	end
	
	WizardUtils.toggleButtonSetCallback(toggleButtonAxis_, command, function()
		staticTooltip_:setVisible(false)
		local Wizard = require('Input.Wizard')
		Wizard.checkLastCombo()
		resetFocusFromButtons()
	end
	, function()
		updateTooltip()
		resetFocusFromButtons()
	end)
	WizardUtils.initToggleButtonState(toggleButtonAxis_, command)
	updateTooltip()
	
	updateStickWidgetData()
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
	local command = commands_[currCommand_]
	if not toggleButtonAxis_:getState() and pageSwitchedByInput ~= true and command.combo.key and deviceId == command.combo.deviceId then
		pageSwitchedByInput = true
		local Wizard = require('Input.Wizard')
		Wizard.selectNextPage()
	end
end

function handleAxis(name, deviceId, value)
	local command = commands_[currCommand_]
	
	if toggleButtonAxis_:getState() and WizardUtils.toggleButtonHandleAxis(toggleButtonAxis_, command.combo, name, deviceId, value) then
		local Wizard = require('Input.Wizard')
		local assingResult = Wizard.checkLastCombo()
		staticTooltip_:setVisible(assingResult)
	end
end

function handleUpdate()
	local inputActions	= Input.getInputActions()
	--local inputAction	= inputActions[#inputActions]
	local command = commands_[currCommand_]
	local pitchValue, rollValue
	
	for i, inputAction in ipairs(inputActions) do
		if command.combo and InputUtils.getInputEvent(command.combo.key) == inputAction.action then
			local valueIn = inputAction.value
			local valueOut = axesTuneWidget_:getFilterValue(valueIn)
			axesTuneWidget_:drawPrimaryPointer(valueIn)
		end
		
		if commands_[1].combo and InputUtils.getInputEvent(commands_[1].combo.key) == inputAction.action then
			pitchValue = inputAction.value
		elseif commands_[2].combo and InputUtils.getInputEvent(commands_[2].combo.key) == inputAction.action then
			rollValue = inputAction.value
		end
	end
	
	if #inputActions == 0 and pageSwitchedByInput == true then
		pageSwitchedByInput = false
	end
	
	StickTestWidget.updateInput(pitchValue, rollValue)
end

function setDeadzone(value)
	local command = commands_[currCommand_]
	command.combo.deadzone = value

	axesTuneWidget_:setDeadZone(value)
	sliderDeadzode_:setValue(value)
	editBoxDeadzone_:setText(value * 100)
	
	updateStickWidgetData()
end

function setCurvature(value)
	local command = commands_[currCommand_]
	command.combo.curvature = {value}

	axesTuneWidget_:setCurvature(0, value)
	sliderCurvature_:setValue(value)
	editBoxCurvature_:setText(value * 100)
	
	updateStickWidgetData()
end

function setIsSlider(isSlider)
	local command = commands_[currCommand_]
	command.combo.isSlider = isSlider

	axesTuneWidget_:setSlider(isSlider)
	checkBoxSlider_:setState(isSlider)
	
	updateStickWidgetData()
end

function setInvert(invert)
	local command = commands_[currCommand_]
	command.combo.invert = invert

	axesTuneWidget_:setInvert(invert)
	checkBoxInvert_:setState(invert)
	
	updateStickWidgetData()
end

function updateStickWidgetData()
	local command = commands_[1]
	local pitchFilter = { deadzone = command.combo.deadzone, curvature = command.combo.curvature, slider = command.combo.isSlider, invert = command.combo.invert}
	command = commands_[2]
	local rollFilter = { deadzone = command.combo.deadzone, curvature = command.combo.curvature, slider = command.combo.isSlider, invert = command.combo.invert}
	
	StickTestWidget.setAxesFilters(pitchFilter, rollFilter)
end

function bindSliderAndEditBox(slider, editBox, filterFunc)
	if slider == nil or editBox == nil then
		return
	end
	
	slider:addChangeCallback(function()
		if filterFunc then
			filterFunc(slider:getValue())
		end
	end)
		
	local min, max = slider:getRange()

	local getEditBoxValue = function()
		local text = editBox:getText()

		local value = min
			
		if text ~= '' then
			value = (tonumber(text) or min) / 100
			value = math.max(min, value)
			value = math.min(max, value)
		end
			
		return value
	end
		
	local prevValue
		
	editBox:addKeyDownCallback(function(widget, keyName, unicode)
		if 'return' == keyName then
			prevValue = getEditBoxValue()
			if filterFunc then
				filterFunc(prevValue)
			end
			editBox:setSelection(0, -1)
		elseif 'escape' == keyName then
			if prevValue then
				if filterFunc then
					filterFunc(prevValue)
				end
				editBox:setSelection(0, -1)
			end
		end
	end)

	editBox:addFocusCallback(function()
		if editBox:getFocused() then
			prevValue = slider:getValue()
		else
			filterFunc(getEditBoxValue())
			prevValue = nil
		end
	end)
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
	toggleButtonAxis_:setFocused(false)
	sliderDeadzode_:setFocused(false)
	sliderCurvature_:setFocused(false)
	editBoxDeadzone_:setFocused(false)
	editBoxCurvature_:setFocused(false)
	checkBoxSlider_:setFocused(false)
end

return {
	getPanelMain = getPanelMain,
	resetCommandIndex = resetCommandIndex,
	resetCombos = resetCombos,
	handleKey = handleKey,
	handleAxis = handleAxis,
	handleUpdate = handleUpdate,
	getCurrentCombo = getCurrentCombo,
	getCombos = getCombos,
	getCombosToSave = getCombosToSave,
	onNext = onNext,
	onPrevious = onPrevious,
	getCommandsCount = getCommandsCount,
	getCurrentCommandIndex = getCurrentCommandIndex,
	resetFocusFromButtons = resetFocusFromButtons,
}