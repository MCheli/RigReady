local DialogLoader = require('DialogLoader')
local AxesTuneWidget = require('AxesTuneWidget')

-- Data
local zoneWidthHalf = 0
local zoneHeightHalf = 0
local pivotWidthHalf = 0
local pivotHeightHalf = 0
local pitchAxisFilter
local rollAxisFilter
local pitchAxisValue = 0
local rollAxisValue = 0

-- Widgets
local panel_
local pivot_
local axesTuneWidget_

-- Functions
local getPanel
local setAxesFilters
local updateInput
local getAxisOutValue

-- Implementation
function getPanel()
	panel_ = nil
	local dialog = DialogLoader.spawnDialogFromFile('./Scripts/Input/StickTestWidget.dlg', {})
	if dialog == nil then
		return nil
	end
	
	panel_ = dialog.panel
	pivot_ = panel_.pivot
	
	pivotWidthHalf, pivotHeightHalf = pivot_:getSize()
	zoneWidthHalf, zoneHeightHalf = panel_:getSize()
	zoneWidthHalf = (zoneWidthHalf - pivotWidthHalf) / 2
	zoneHeightHalf = (zoneHeightHalf - pivotHeightHalf) / 2
	pivotWidthHalf = pivotWidthHalf / 2
	pivotHeightHalf = pivotHeightHalf / 2
	
	axesTuneWidget_ = AxesTuneWidget.new()
	axesTuneWidget_:setBounds(panel_:getBounds())
	axesTuneWidget_:setInRange(1)
	axesTuneWidget_:setOutRange(1)
	
	dialog:removeWidget(dialog.panel)
	dialog:kill()
	
	panel_:setPosition(0, 0)
	
	return panel_
end

function setAxesFilters(pitchFilter, rollFilter) -- tables with deadzone, curvature, slider, invert
	pitchAxisFilter = pitchFilter
	rollAxisFilter = rollFilter
end

function updateInput(pitchValue, rollValue)
	pitchAxisValue = getAxisOutValue(pitchValue, pitchAxisFilter) or pitchAxisValue
	rollAxisValue = getAxisOutValue(rollValue, rollAxisFilter) or rollAxisValue
	local x = zoneWidthHalf + rollAxisValue * zoneWidthHalf
	local y = zoneWidthHalf + pitchAxisValue * zoneWidthHalf
	pivot_:setPosition(x, y)
end

function getAxisOutValue(axisValue, filter)
	if axisValue == nil then
		return nil
	end
	
	axesTuneWidget_:setDeadZone(filter.deadzone or 0)
	axesTuneWidget_:setCurvature(0, filter.curvature and filter.curvature[1] or 0)
	axesTuneWidget_:setSlider(filter.slider or false)
	axesTuneWidget_:setInvert(filter.invert or false)
	return axesTuneWidget_:getFilterValue(axisValue)
end

return {
	getPanel = getPanel,
	setAxesFilters = setAxesFilters,
	updateInput = updateInput,
}