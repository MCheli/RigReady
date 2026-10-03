local Input 			= require('Input'				)
local InputData 		= require('Input.Data'			)
local InputUtils 		= require('Input.Utils'			)
local WizardUtils 		= require('Input.WizardUtils'	)
local DialogLoader 		= require('DialogLoader'		)
local UpdateManager 	= require('UpdateManager'		)
local Serializer 		= require('Serializer'			)
local MsgWindow			= require('MsgWindow'			)
local lfs 				= require('lfs'					)
local i18n				= require('i18n'				)

local WizardInfoPage = require('Input.WizardInfoPage')
local WizardAxisPage = require('Input.WizardAxisPage')
local WizardKeysPage = require('Input.WizardKeysPage')
local WizardCompleteResultPage = require('Input.WizardCompleteResultPage')

local _ = i18n.ptranslate

-- Constants
local layerName_ = 'Wizard'
local cdata = {
	controlsWizard = _('Wizard.DialogTitle'),
	save = _('SAVE'),
	cancel = _('CANCEL'),
	nextPage = _('NEXT'),
	previousPage = _('BACK'),
	reset = _('RESET'),
	toBegin = _('TO BEGIN'),
	resetWizardTitle = _('Wizard.ResetTitle'),
	confirmResetWizard = _('Wizard.ResetConfirmation'),
	cancelWizardTitle = _('Wizard.CancelTitle'),
	confirmCancelWizard = _('Wizard.CancelConfirmation'),
	yes = _('YES'),
	no = _('NO'),
}
local pages_ = {
	{pageType = 'Start' , description = _('Wizard.StartPageDescription'), pageInst = WizardInfoPage},
	{pageType = 'AxisesSetup' , pageInst = WizardAxisPage},
	{pageType = 'KeysSetup' , pageInst = WizardKeysPage},
	{pageType = 'WizardResultInfo', description = _('Wizard.ResultPageDescription'), pageInst = WizardCompleteResultPage},
}

local wizardFilePath = lfs.writedir() .. 'Config/Input/wizard.lua'

-- Data
local profileName_
local onSaveCallback_
local modifiers_
local handleKeyFunc_
local handleAxisFunc_
local handleUpdateFunc_
local currPageIndex_ = 1

-- Widgets
local window_
local staticWarning_
local progressBar_
local buttonDone_
local buttonCancel_
local buttonNext_
local buttonPrev_
local buttonWizardReset_
local buttonToBegin_

-- Functions
local create
local show
local kill
local selectPage
local selectNextPage
local selectPreviousPage
local resetFocusFromButtons
local resetWizard
local checkLastCombo
local save
local getAllCombos
local addInputModifierKeys
local addInputDeviceKeys
local addInputDeviceAxes
local createInputLayer
local process
local changeProgress

function create()
	window_ = DialogLoader.spawnDialogFromFile('./Scripts/Input/Wizard.dlg', cdata)
	
	window_:centerWindow()
	
	staticWarning_ = window_.staticWarning
	progressBar_ = window_.progressBar
	
	local bottomPanel_ = window_.bottomPanel
	if bottomPanel_ then
		buttonDone_ = bottomPanel_.buttonDone
		buttonCancel_ = bottomPanel_.buttonCancel
		buttonNext_ = bottomPanel_.buttonNext
		buttonPrev_ = bottomPanel_.buttonPrev
		buttonWizardReset_ = bottomPanel_.buttonWizardReset
		buttonToBegin_ = bottomPanel_.buttonToBegin
		
		function buttonNext_:onChange()
			selectNextPage()
		end
		
		function buttonPrev_:onChange()
			selectPreviousPage()
		end
		
		function buttonDone_:onChange()
			save()
			kill()
		end
		
		function buttonCancel_:onChange()
			cancelWizard()
		end
		
		function buttonWizardReset_:onChange()
			resetWizard()
		end
		
		function buttonToBegin_:onChange()
			pages_[2].pageInst.resetCommandIndex()
			pages_[3].pageInst.resetCommandIndex()
			selectPage(2)
		end
		
	end
	
	currPageIndex_ = 1
	local comboCount = 0
	
	for i, page in ipairs(pages_) do
		local value = 0
		if page.pageInst.getCommandsCount then
			value = page.pageInst.getCommandsCount()
		end
		comboCount = comboCount + value
	end
	
	progressBar_:setRange(0, comboCount)
end

function show(profileName, callback)	
	profileName_	= profileName
	onSaveCallback_ = callback
	
	if not window_ then
		create()
	end
	
	WizardUtils.resetCombos()
	
	for i, page in ipairs(pages_) do
		if page.pageInst.resetCommandIndex then
			page.pageInst.resetCommandIndex()
		end
		
		if page.pageInst.resetCombos then
			page.pageInst.resetCombos()
		end
	end
	
	createInputLayer()
	selectPage(currPageIndex_)
	
	Input.addDeviceChangeCallback(createInputLayer)
	UpdateManager.add(process)
	
	window_:setVisible(true)
end

function kill()
	Input.removeDeviceChangeCallback(createInputLayer)
	Input.deleteLayer(layerName_)
	UpdateManager.delete(process)
	
	if window_ then
		window_:kill()
		window_ = nil
	end
end

function selectPage(pageIndex)
	-- удаляем предыдущую страницу
	local currPanelMain = window_.panelMain:getWidget(0)
	if currPanelMain then
		window_.panelMain:removeWidget(currPanelMain)
	end
	
	-- добавляем новую страницу
	local pageInfo = pages_[pageIndex]
	local currentPageInstance = pageInfo.pageInst
	
	local mainPanel = currentPageInstance.getPanelMain()
	if mainPanel then
		window_.panelMain:insertWidget(mainPanel)
	else
		currPageIndex_ = pageIndex
		selectNextPage()
		return
	end
	
	if currentPageInstance.setDescription then
		currentPageInstance.setDescription(pageInfo.description)
	end
	
	if pageInfo.pageType == 'Start' then
		buttonDone_:setVisible(false)
		buttonCancel_:setVisible(true)
		buttonNext_:setVisible(true)
		buttonPrev_:setVisible(false)
		buttonToBegin_:setVisible(false)
		
		if currentPageInstance.setAnyButtonContinueEnabled then
			currentPageInstance.setAnyButtonContinueEnabled(true)
		end
		
		local f, err = loadfile(wizardFilePath)
		buttonWizardReset_:setVisible(f ~= nil and true or false)
	elseif pageInfo.pageType == 'WizardResultInfo' then
		buttonDone_:setVisible(true)
		buttonCancel_:setVisible(true)
		buttonNext_:setVisible(false)
		buttonPrev_:setVisible(true)
		buttonWizardReset_:setVisible(false)
		buttonToBegin_:setVisible(true)
	else
		buttonDone_:setVisible(false)
		buttonCancel_:setVisible(true)
		buttonNext_:setVisible(true)
		buttonPrev_:setVisible(true)
		buttonWizardReset_:setVisible(false)
		buttonToBegin_:setVisible(false)
	end
	
	handleKeyFunc_ = currentPageInstance.handleKey
	handleAxisFunc_	= currentPageInstance.handleAxis
	handleUpdateFunc_ = currentPageInstance.handleUpdate
	currPageIndex_ = pageIndex
	updateProgressBar()
	resetFocusFromButtons()
end

function selectNextPage()
	local currPage	= pages_[currPageIndex_].pageInst
	local handled	= currPage.onNext and currPage.onNext()
	
	if not handled then -- если страница не обработала нажатие на кнопку 
		if currPageIndex_ < #pages_ then
			if checkLastCombo() then
				selectPage(currPageIndex_ + 1)
			end
		end
	else
		updateProgressBar()
	end
end

function selectPreviousPage()
	local currPage	= pages_[currPageIndex_].pageInst
	local handled	= currPage.onPrevious and currPage.onPrevious()
	
	if not handled then -- если страница не обработала нажатие на кнопку
		if currPageIndex_ > 1 then
			if checkLastCombo() then
				selectPage(currPageIndex_ - 1)
			end
		end
	else
		updateProgressBar()
	end
end

function resetFocusFromButtons()
	buttonDone_:setFocused(false)
	buttonCancel_:setFocused(false)
	buttonNext_:setFocused(false)
	buttonPrev_:setFocused(false)
	buttonWizardReset_:setFocused(false)
	buttonToBegin_:setFocused(false)

	local currentPageInstance = pages_[currPageIndex_].pageInst
	if currentPageInstance.resetFocusFromButtons then
		currentPageInstance.resetFocusFromButtons()
	end
end

function cancelWizard()
	if currPageIndex_ == 1 then
		kill()
		return
	end
	
	local handler = MsgWindow.question(cdata.confirmCancelWizard, cancelWizardTitle, cdata.yes, cdata.no)

	function handler:onChange(buttonText)
		if buttonText == cdata.yes then
			kill()
		end
	end

	handler:show()
end

function resetWizard()
	local handler = MsgWindow.question(cdata.confirmResetWizard, resetWizardTitle, cdata.yes, cdata.no)

	function handler:onChange(buttonText)
		if buttonText == cdata.yes then
			os.remove(wizardFilePath)
			
			InputData.unloadProfiles()
	
			if onSaveCallback_ then
				onSaveCallback_()
			end
			
			Input.setTopLayer(layerName_)
			
			buttonWizardReset_:setVisible(false)
		end
	end

	handler:show()
end

function checkLastCombo()
	local currentPageInstance = pages_[currPageIndex_].pageInst
	if not currentPageInstance.getCurrentCombo then
		return true
	end
	
	local messagesEquals = WizardUtils.checkLastCombo(currentPageInstance.getCurrentCombo())
	if messagesEquals then
		staticWarning_:setVisible(true)	
		staticWarning_:setText(table.concat(messagesEquals, '\n'))
		return false
	else
		staticWarning_:setVisible(false)
	end
	
	--return true to allow skip  current  step , not always interesting about some particular  assignments 
	return true
end

function save()
	local result = {}
	
	for i, page in ipairs(pages_) do
		if page.pageInst.getCombosToSave then
			for name, combo in pairs(page.pageInst.getCombosToSave()) do
				if combo.deviceId ~= nil and combo.deviceId ~= 0 and combo.key ~= nil then					
					local deviceName = InputUtils.getDeviceNameById(combo.deviceId) or ""
					result[deviceName] = result[deviceName] or {}
					
					result[deviceName][name] = { 
						key = combo.key, 
						reformers = WizardUtils.getComboReformers(combo),
						filter = {
							deadzone = combo.deadzone,
							curvature = combo.curvature,
							slider = combo.isSlider,
							invert = combo.invert,
						}
					}
					
					local filtersCount = 0
					for i, v in pairs(result[deviceName][name].filter) do
						filtersCount = filtersCount + 1
					end
					
					if filtersCount == 0 then
						result[deviceName][name].filter = nil
					end
				end
			end
		end
	end
	
	local file, err	= io.open(wizardFilePath, 'w')
	
	if file then
		local s = Serializer.new(file)
		s:serialize_sorted('local result', result)
		file:write('return result')
		file:close()
	else
		print(string.format('Cannot save wizard results into file[%s]! Error %s', filename, err))
	end
	
	InputData.unloadProfiles()
	
	if onSaveCallback_ then
		onSaveCallback_()
	end
end

function getAllCombos()
	local result = {}
	for i, page in ipairs(pages_) do
		if page.pageInst.getCombos then
			for name, combo in pairs(page.pageInst.getCombos()) do
				result[name] = combo
			end
		end
	end
	
	return result
end

function addInputModifierKeys()
	for modifierName, modifier in pairs(modifiers_) do	
		local event = modifier.event

		if event then
			local deviceId			= modifier.deviceId
			local reformers			= nil
			local down				= event
			local pressed			= nil
			local up				= nil

			Input.addKeyCombo(layerName_, event, deviceId, reformers, down, pressed, up)
		end
	end
end

function addInputDeviceKeys(deviceName)
	local deviceKeys	= InputUtils.getDeviceKeysNoModifiers(deviceName, modifiers_)
	local eventsToSkip	= InputUtils.getDeviceEventsToSkip(deviceName)
	local deviceId		= Input.getDeviceId(deviceName) 

	for i, deviceKey in ipairs(deviceKeys) do
		local event = deviceKey.event

		if not eventsToSkip[event] then
			local reformers	= nil
			local down		= event
			local pressed	= nil
			local up		= nil
			
			Input.addKeyCombo(layerName_, event, deviceId, reformers, down, pressed, up)
		end
	end
end

function addInputDeviceAxes(deviceName)
	local deviceAxes	= InputUtils.getDeviceAxes(deviceName)
	local eventsToSkip	= InputUtils.getDeviceEventsToSkip(deviceName)
	local deviceId		= Input.getDeviceId(deviceName)

	for i, deviceAxis in ipairs(deviceAxes) do
		local event = deviceAxis.event

		if not eventsToSkip[event] then
			local reformers	= nil
			local action	= event
			local filter	= nil
			
			Input.addAxisCombo(layerName_, event, deviceId, reformers, action, filter)
		end
	end
end

function createInputLayer()
	Input.deleteLayer(layerName_)
	Input.createLayer(layerName_)
	
	local devices	= InputUtils.getDevices()
	modifiers_		= InputData.getProfileModifiers(profileName_)
	
	addInputModifierKeys()
	
	for i, deviceName in ipairs(Input.getDevices()) do
		addInputDeviceKeys(deviceName)
		addInputDeviceAxes(deviceName)
	end
	
	Input.clearLayerStack()
	Input.setTopLayer(layerName_)
end

function process()
	if handleUpdateFunc_ then
		handleUpdateFunc_()
	end
	
	for i, inputAction in ipairs(Input.getInputActions()) do
		if inputAction.hasValue then
			if handleAxisFunc_ then
				handleAxisFunc_(InputUtils.getDeviceEventName(inputAction.action), inputAction.deviceId, inputAction.value)
			end
		else
			local isModifier = false
			
			for modifierName, modifier in pairs(modifiers_) do
				if modifier.event == inputAction.action then
					isModifier = true
					
					break
				end
			end
			
			if handleKeyFunc_ then
				handleKeyFunc_(InputUtils.getDeviceEventName(inputAction.action), inputAction.deviceId, isModifier)
			end
		end
	end
end

function changeProgress(delta)
	progressBar_:setValue(progressBar_:getValue() + delta)
end

function updateProgressBar()
	local rangeMin, rangeMax = progressBar_:getRange()
	if currPageIndex_ == 1 then
		progressBar_:setValue(rangeMin)
	elseif currPageIndex_ == #pages_ then
		progressBar_:setValue(rangeMax)
	else
		local progressValue = 0
		for i = 1, currPageIndex_, 1 do
		    if pages_[i].pageInst.getCurrentCommandIndex then
			    progressValue = progressValue + pages_[i].pageInst.getCurrentCommandIndex()
			end
		end
		progressBar_:setValue(progressValue)
	end
	
	--local currentPageInstance = pages_[currPageIndex_].pageInst
--getCurrentCommandIndex

end

return {
	create				= create,
	show				= show,
	kill				= kill,
	selectNextPage 		= selectNextPage,
	selectPreviousPage 	= selectPreviousPage,
	checkLastCombo		= checkLastCombo,
	getAllCombos		= getAllCombos,
	changeProgress		= changeProgress,
	updateProgressBar	= updateProgressBar,
}
