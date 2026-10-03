local DialogLoader	= require('DialogLoader'		)
local WizardUtils	= require('Input.WizardUtils'	)

-- Data
local widgetsCount = 0
local textLineHeight = 32
local textLineWidth = 500
local staticSkin

-- Widgets
local panelMain_
local staticText_
local scrollPanel_

-- Functions
local getPanelMain
local setMessages
local clearMessages
local addTextLine

-- Implementation
function getPanelMain()
	local Wizard = require('Input.Wizard')
	local messagesEmpty = WizardUtils.getEmptyComboMessages(Wizard.getAllCombos())
	
	local dialog = DialogLoader.spawnDialogFromFile('./Scripts/Input/WizardCompleteResultPage.dlg', {})
	
	panelMain_ = dialog.panelMain
	panelMain_:setPosition(0, 0)
	scrollPanel_ = panelMain_.scrollPanel
	staticText_ = panelMain_.staticText
	local w, h = panelMain_:getSize()
	textLineWidth = w - 2
	
	staticSkin = dialog.staticSkinExample:getSkin()
	
	dialog:removeWidget(dialog.panelMain)
	dialog:kill()
	
	if messagesEmpty then
		staticText_:setVisible(false)
		scrollPanel_:setVisible(true)
		setMessages(messagesEmpty)
	else
		staticText_:setVisible(true)
		scrollPanel_:setVisible(false)
	end
	
	return panelMain_ 
end

function setDescription(text)
	local staticText_ = panelMain_.staticText
	if staticText_ and text then
		staticText_:setText(text)
	end
end

function setMessages(messages)
	clearMessages()
	
	if not messages then
		return
	end
	
	for i, msg in ipairs(messages) do
		addTextLine(msg)
	end
end

function clearMessages()
	scrollPanel_:clear()
	widgetsCount = 0
end

function addTextLine(text)
	if not scrollPanel_ then
		return
	end
	
	local item = Static.new()
    item:setSkin(staticSkin)    
    item:setBounds(0, widgetsCount * textLineHeight, textLineWidth, textLineHeight)
	item:setText(text)
	item:setSize(textLineWidth, item:getTextLinesCount() * textLineHeight)
	local x, y = item:getPosition()
	local w, h = item:getSize()
	
    scrollPanel_:insertWidget(item)
	
	widgetsCount = widgetsCount + 1
end

return {
	getPanelMain = getPanelMain,
	setDescription = setDescription,
	setMessages = setMessages,
	clearMessages = clearMessages,
}