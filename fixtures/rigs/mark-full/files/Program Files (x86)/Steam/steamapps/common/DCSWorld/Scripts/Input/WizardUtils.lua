local Input = require('Input')
local InputData = require('Input.Data')
local InputUtils = require('Input.Utils')
local i18n = require('i18n')

local _ = i18n.ptranslate

local combos_ 		= {}
local axisValues_	= {}
local cdata 		= {			
	pressKey		= _('Wizard.PressKeyWaiting'),
	moveAxis		= _('Wizard.MoveAxisWaiting'),
	notAssigned		= _('Wizard.NotAssigned'),
	comboIsEmpty	= _('Wizard.ComboIsEmpty'),
	comboIsEqualTo	= _('Wizard.ComboEqualTo'),
}

local function makeKeyCombo()
	return {
		reformer1		= nil	,
		reformer2		= nil	,
		reformer3		= nil	,
		key				= nil	,
		deviceId		= nil	,
		reformerCounter	= 0		,
		deadzone		= nil	,
		curvature		= nil	,
		isSlider		= nil	,
		invert			= nil	,
	}
end

local function cloneCombo(combo)
	return {
		reformer1		= combo.reformer1			,
		reformer2		= combo.reformer2			,
		reformer3		= combo.reformer3			,
		key				= combo.key					,
		deviceId		= combo.deviceId			,
		reformerCounter = 0							,
		deadzone		= combo.deadzone or 0		,
		curvature		= combo.curvature			,
		isSlider		= combo.isSlider or false	,
		invert			= combo.invert or false	,
	}
end

local function getComboString(combo)
	local result
	
	if combo.reformer1 then
		result = combo.reformer1
	end
	
	if combo.reformer2 then
		result = result .. '+' .. combo.reformer2
	end	
	
	if combo.reformer3 then
		result = result .. '+' .. combo.reformer3
	end	
	
	if combo.key then
		if result then
			result = result .. '+' .. combo.key
		else
			result = combo.key
		end
	end
	
	return result
end

local function getComboReformers(combo)
	local result
	
	if 	combo.reformer1 then
		result = {}
		table.insert(result, combo.reformer1)
	end
	
	if 	combo.reformer2 then
		result = result or {}
		table.insert(result, combo.reformer2)
	end
	
	if 	combo.reformer3 then
		result = result or {}
		table.insert(result, combo.reformer3)
	end
	
	return result
end

local function getComboEmpty(combo)
	return not (combo.reformer1	or
				combo.reformer2	or
				combo.reformer3	or
				combo.key)
end

local function getCombosAreEqual(combo1, combo2)
	return	combo1.reformer1	== combo2.reformer1 and
			combo1.reformer2	== combo2.reformer2 and
			combo1.reformer3	== combo2.reformer3 and
			combo1.key      	== combo2.key and
			combo1.deviceId		== combo2.deviceId
end

local function setComboReformerName(combo, name)
	if 	name ~= combo.reformer1 and 
		name ~= combo.reformer2 and 
		name ~= combo.reformer3 then 
		
		combo['reformer' .. (combo.reformerCounter % 3) + 1] = name
		combo.reformerCounter = combo.reformerCounter + 1
	end
end

local function resetCombo(combo)
	combo.reformer1			= nil
	combo.reformer2			= nil
	combo.reformer3			= nil
	combo.key				= nil
	combo.reformerCounter	= 0
	combo.deadzone			= nil
	combo.curvature			= nil
	combo.isSlider			= nil
	combo.invert			= nil
end

local function resetCombos()
	combos_ = {}	
end

local function printCombo(combo)
	print('key ' .. tostring(combo.key) .. '\nR1 ' .. tostring(combo.reformer1) .. '\nR2 ' .. tostring(combo.reformer2) .. '\nR3 ' .. tostring(combo.reformer3))
end

local function checkLastCombo(combos)
	local result = true
	local messages = nil
	
	for newName, newCombo in pairs(combos) do
		combos_[newName] = nil -- удаляем предыдущий биндинг
	end
	
	for newName, newCombo in pairs(combos) do
		if not getComboEmpty(newCombo.combo) then
			for name, combo in pairs(combos_) do				
				if getCombosAreEqual(combo.combo, newCombo.combo) then
					result	= false
					messages = messages or {}
					table.insert(messages, string.format(cdata.comboIsEqualTo, newCombo.caption, combo.caption))
				end
			end
			
			if result then
				combos_[newName] = { combo = cloneCombo(newCombo.combo), caption = newCombo.caption }
			end
		end
	end
	
	return messages
end

local function getEmptyComboMessages(combos)
	local messages = nil
	
	for name, combo in pairs(combos) do				
		if getComboEmpty(combo.combo) then
			messages = messages or {}
			table.insert(messages, string.format(cdata.comboIsEmpty, combo.caption))
		end
	end
	
	return messages
end

local function getComboCount(combos)
	local result = 0
	
	for name, combo in pairs(combos) do
		result = result + 1
	end
	
	return result
end

local function toggleButtonHandleKey(toggleButton, combo, keyName, deviceId, isModifier)
	if toggleButton:getState() then
		if isModifier then
			setComboReformerName(combo, keyName)
			toggleButton:setText(getComboString(combo))
		else
			combo.key		= keyName
			combo.deviceId	= deviceId
			
			toggleButton:setTooltipText(InputUtils.getDeviceTemplateName(InputUtils.getDeviceNameById(deviceId) or ""))
			toggleButton:setText(getComboString(combo))
			toggleButton:setState(false)
			
			return true
		end
	end
	
	return false
end

local function toggleButtonHandleAxis(toggleButton,  combo, axisName, deviceId, value)
	if toggleButton:getState() then
		local axisValues = axisValues_[axisName] or {min = 0, max = 0}
		
		if value < 0 then
			axisValues.min = math.min(value, axisValues.min)
		else
			axisValues.max = math.max(value, axisValues.max)
		end
		
		if 	axisValues.min < -0.9 and
			axisValues.max >  0.9 then
			
			combo.key		= axisName
			combo.deviceId	= deviceId			
			
			toggleButton:setText(getComboString(combo))
			toggleButton:setTooltipText(InputUtils.getDeviceTemplateName(InputUtils.getDeviceNameById(deviceId) or ""))
			
			axisValues_ = {}
			toggleButton:setState(false)
			
			return true
		else
			axisValues_[axisName] = axisValues
		end
	end
	
	return false
end

local function pressToggleButton(toggleButton, combo, text)	
	toggleButton:setText(text)
	toggleButton:setTooltipText()
	resetCombo(combo)
end

local function toggleButtonSetCombo(toggleButton, combo)
	if combo.key then
		toggleButton:setText(getComboString(combo))
		toggleButton:setTooltipText(InputUtils.getDeviceTemplateName(InputUtils.getDeviceNameById(combo.deviceId) or ""))
	else
		toggleButton:setText(cdata.notAssigned)
		toggleButton:setTooltipText()
	end
end

local function releaseToggleButton(toggleButton, combo)
	toggleButton:setState(false)
	toggleButtonSetCombo(toggleButton, combo)		
end

local function toggleButtonReset(toggleButton, command)
	toggleButton:setText(command.caption)
	toggleButton:setTooltipText()
	resetCombo(command.combo)	
	axisValues_ = {}
end

local function initToggleButtonState(toggleButton, command)
	if not command.combo.key then
		toggleButton:setState(true)
		toggleButton:setText(command.isAxis and cdata.moveAxis or cdata.pressKey)
		toggleButton:setTooltipText()
	else
		releaseToggleButton(toggleButton, command.combo)
	end
end

local function toggleButtonsSetCallback(toggleButtonKey1, toggleButtonKey2, toggleButtonAxis, command1, command2, commandAxis)
	function toggleButtonKey1:onChange()
		if toggleButtonKey1:getState() then
			pressToggleButton(toggleButtonKey1, command1.combo, cdata.pressKey)	
			releaseToggleButton(toggleButtonKey2, command2.combo)
			releaseToggleButton(toggleButtonAxis, commandAxis.combo)
		else
			releaseToggleButton(toggleButtonKey1, command1.combo)
			toggleButtonReset(toggleButtonKey1, command1)
			axisValues_ = {}
		end
	end
		
	function toggleButtonKey2:onChange()
		if toggleButtonKey2:getState() then
			pressToggleButton(toggleButtonKey2, command2.combo, cdata.pressKey)	
			releaseToggleButton(toggleButtonKey1, command1.combo)
			releaseToggleButton(toggleButtonAxis, commandAxis.combo)
		else
			releaseToggleButton(toggleButtonKey2, command2.combo)
			toggleButtonReset(toggleButtonKey2, command2)
			axisValues_ = {}
		end			
	end
	
	function toggleButtonAxis:onChange()
		if toggleButtonAxis:getState() then
			pressToggleButton(toggleButtonAxis, commandAxis.combo, cdata.moveAxis)	
			releaseToggleButton(toggleButtonKey1, command1.combo)
			releaseToggleButton(toggleButtonKey2, command2.combo)
		else
			releaseToggleButton(toggleButtonAxis, commandAxis.combo)
			toggleButtonReset(toggleButtonAxis, commandAxis)
		end
	end
end

local function toggleButtonSetCallback(toggleButton, command, onPressCallback, onReleaseCallback)
	function toggleButton:onChange()
		if toggleButton:getState() then
			pressToggleButton(toggleButton, command.combo, cdata.pressKey)
			if onPressCallback then
				onPressCallback()
			end
		else
			releaseToggleButton(toggleButton, command.combo)
			if onReleaseCallback then
				onReleaseCallback()
			end
		end
	end
end

local function getWizardComboFromSave(assignmentName)
	local result = makeKeyCombo()
	local wizardAssignments = InputData.getWizardAssignments()
	if wizardAssignments then
		for deviceName, deviceAssignments in pairs(wizardAssignments) do
			if deviceName ~= "" then
				local assignment = deviceAssignments[assignmentName]
				local deviceId = Input.getDeviceId(deviceName)
				if assignment and deviceId ~= 0 then
					result.key = assignment.key
					result.deviceId = deviceId
					
					if assignment.reformers then
						for i, value in ipairs(assignment.reformers) do
							result["reformer" .. i] = value
							result.reformerCounter = result.reformerCounter + 1
						end
					end
					
					if assignment.filter then
						result.deadzone = assignment.filter.deadzone
						result.curvature = assignment.filter.curvature
						result.isSlider = assignment.filter.slider
						result.invert = assignment.filter.invert
					end
					
					return result
				end
			end
		end
	end
	
	return result
end

return {
	makeKeyCombo				= makeKeyCombo				,
	getComboString				= getComboString			,
	getComboReformers			= getComboReformers			,
	getComboEmpty				= getComboEmpty				,
	setComboReformerName 		= setComboReformerName		,
	resetCombo					= resetCombo				,
	resetCombos					= resetCombos				,
	checkLastCombo				= checkLastCombo			,
	getEmptyComboMessages		= getEmptyComboMessages		,
	getComboCount				= getComboCount				,
	toggleButtonHandleKey		= toggleButtonHandleKey		,
	toggleButtonHandleAxis		= toggleButtonHandleAxis	,
	toggleButtonsSetCallback	= toggleButtonsSetCallback	,
	toggleButtonSetCallback 	= toggleButtonSetCallback	,
	toggleButtonReset			= toggleButtonReset			,
	initToggleButtonState		= initToggleButtonState		,
	toggleButtonSetCombo		= toggleButtonSetCombo		,
	releaseToggleButton			= releaseToggleButton		,
	getWizardComboFromSave		= getWizardComboFromSave	,
}