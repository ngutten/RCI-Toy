function Event()
{
	var activateEffect = function(pdata) {}; // This happens when the event activates
	var duringEffect = function(pdata) {}; // This happens each month, but don't put RCI changes here - use the 'drift' variables instead
	var removeEffect = function(pdata) {}; // This happens when the event is removed

	var canTrigger = function(pdata) {}; // Determines if the event can occur or not
	var chancePerYear = 0;
	var duration = -1; // -1 = Permanent, otherwise duration in months
	var name = "Event";
	var desc = "This is description text explaining the event.";
	var startMessage = "An event has occured!";
}

function Action()
{
	var resourcesToComplete = 0; // How many budget points are needed to complete this action
	var minTimeToComplete = 0; // How much time is needed to complete this action at minimum
	
	var conditionFunc = function(pdata) {}; // Function determining whether or not the action can be chosen
	var weightFunc = function(pdata) {}; // Determine the weight for choosing this action
	
	var duringFunc = function(pdata) {}; // Execute each month
	var interruptFunc = function(pdata) {}; // Execute if this action is cancelled
	var finishFunc = function(pdata) {}; // Execute when this action finishes
	
	var name = "Action";
	var desc = "This is description text explaining the action.";
	var startMessage = "The planet has chosen to begin a project!";
}

var planetData =
{
	RCI: {
		economy: 0,
		medicine: 0,
		environment: 0,
		order: 0,
	},
	
	population: 0.5,
	landAvail: 2,
	landPotential: 10,
	technology: 0,
	infrastructure: 0,
	armada: 0,
	
	popFactors: {
		growth: 0,
		death: 0,
		growthMod: 0, // Set by events/etc
		deathMod: 0 // Set by events/etc
	},
	
	budget: { 
		Total: 0,
		
		// The following are weights, which can be adjusted by projects/etc
		economy: 1,
		medicine: 1,
		environment: 1,
		order: 1,
		
		trade: 1,
		research: 1,
		infrastructure: 1,
		military: 1,
		
		discretionary: 1 // resources that go towards project completion
	},
	
	drift: {
		economy: 0,
		medicine: 0,
		environment: 0,
		order: 0
	},

	goals: [],
	curAction: null,
	timeLeft: 0,
	resourcesLeft: 0,
	
	eventList: [],
	statusList: [],
	
	model:
	{
		timeScale: 0.1,
		popGrowth: "Logistic", // Options are "Linear", "Hybrid", "Logistic"
		RCI: "Ising", // Options are 'Open', 'Capped', 'Ising'
		economyModel: "Linear" // Options are 'Linear', 'Exponential'
		
		RCIalpha: 0.75,
		
		randomEventSet: [],
		actionSet: [],
		statusSet: [],
	}
};

function adjustRCIIsing(pdata, rcitype, delta)
{
	var value = pdata.RCI[rcitype];
	var alpha = pdata.model.RCIalpha;
	
	if (delta>0)
	{
		pdata.RCI[rcitype] += 2*delta*Math.exp(alpha*value/100)*(100-value)/200;
		if (pdata.RCI[rcitype]>100) pdata.RCI[rcitype]=100;
	}
	else
	{
		pdata.RCI[rcitype] += 2*delta*Math.exp(-alpha*value/100)*(100+value)/200;
		if (pdata.RCI[rcitype]<-100) pdata.RCI[rcitype]=-100;
	}
}

function updateRCI(pdata, rcitype, delta)
{
	var dir, intervals;
	switch (pdata.model.RCI)
	{
		case "Ising":
			dir=1;
			if (delta<0) { dir=-1; delta=-delta; }
	
			intervals = Math.floor(delta/0.1);
	
			for (var i=0;i<intervals;i++)
				adjustRCIIsing(pdata,rcitype,dir*0.1);
			adjustRCIIsing(pdata,rcitype, dir*(delta-0.1*intervals));
		break;
		
		case "Open":
			pdata.RCI[rcitype]+=delta;
		break;
		
		case "Capped":
			pdata.RCI[rcitype]+=delta;
			if (pdata.RCI[rcitype]<-100) pdata.RCI[rcitype]=-100;
			if (pdata.RCI[rcitype]>100) pdata.RCI[rcitype]=100;
		break;
	}
}

function assignBudget(pdata)
{
	var econMult;
	
	switch (pdata.model.economyModel)
	{
		case "Linear":
			econMult = 1.0+0.5*pdata.RCI.economy/100;
			break;
		case "Exponential":
			econMult = Math.exp(2.0 * pdata.RCI.economy/100.0);
			break;
	}
	
	pdata.budget.Total = pdata.population*econMult;
}

function getGrowthFactors(pdata)
{
	var envFactor = pdata.RCI.environment/100.0;
	var ordFactor = pdata.RCI.order/100.0;
	if (envFactor>0) envFactor=0;
	if (ordFactor>0) ordFactor=0;
	
	pdata.growthFactors.growth = 0.1 + pdata.growthFactors.growthMod;
	pdata.growthFactors.death = (0.01 + pdata.growthFactors.deathMod + 0.03*envFactor + 0.015*ordFactor)*Math.exp(-2*pdata.RCI.medicine/100.0);
	if (pdata.growthFactors.death<0) pdata.growthFactors.death=0;
	if (pdata.growthFactors.growth<0) pdata.growthFactors.growth=0;
}

function updatePopulation(pdata)
{
	var dP;
	
	switch (pdata.model.popGrowth)
	{
		case "Linear":
			dP = (pdata.growthFactors.growth - pdata.growthFactors.death)*pdata.population;
		break;
		case "Hybrid":
			dP = (pdata.growthFactors.growth * pdata.population * (1.0 - pdata.population / pdata.landAvail ) - pdata.growthFactors.death * pdata.population);
		break;
		case "Logistic":
		break;
	}
	
	pdata.population += pdata.model.timeScale * dP;
	
	if (pdata.population < 0) pdata.population = 0;
	if (pdata.population > pdata.landAvail) pdata.population = pdata.landAvail;
}

function getTotalBudgetWeight(budget)
{
	return budget.trade + budget.research + budget.infrastructure + budget.discretionary + budget.medicine + budget.economy + budget.military + budget.medicine + budget.order + budget.environment;
}

// Update the current planetary action
function updateProject(pdata)
{
	if (pdata.curAction != null)
	{
		pdata.timeLeft -= pdata.model.timeScale;
		
		if (pdata.resourcesLeft > 0)
		{
			var resourcesProvided = pdata.model.timeScale * pdata.budget.Total * pdata.budget.discretionary / getTotalBudgetWeight(pdata.budget);		
			pdata.resourcesLeft -= resourcesProvided;
			if (pdata.resourcesLeft < 0) pdata.resourcesLeft = 0;
		} else pdata.budget.discretionary = 0;
		
		pdata.curAction.duringFunc(pdata);
		
		if ((pdata.timeLeft <= 0)&&(pdata.resourcesLeft <= 0))
		{
			pdata.curAction.finishFunc(pdata);
			pdata.curAction = null;
			
			chooseNextProject(pdata);
		}
	}
}

function chooseNextProject(pdata)
{
	var wtotal = 0;
	
	for (var i=0;i<pdata.model.actionSet.length;i++)
	{
		if (pdata.model.actionSet[i].conditionFunc(pdata))
			pdata.model.actionSet[i].weight = pdata.model.actionSet[i].weightFunc(pdata);
		else pdata.model.actionSet[i].weight = 0;
		
		wtotal += pdata.model.actionSet[i].weight;
	}
	
	var w = Math.random() * wtotal;
	
	var outcome = -1;
	
	for (var i=0;(i<pdata.model.actionSet.length)&&(w>=0);i++)
	{
		w -= pdata.model.actionSet[i].weight;
		
		if (w<0)
			outcome = i;
	}
	
	pdata.curAction = pdata.model.actionSet[i];
	pdata.timeLeft = pdata.model.actionSet[i].minTimeToComplete;
	pdata.resourcesLeft = pdata.model.actionSet[i].resourcesToComplete;
	if (pdata.resourcesLeft > 0) pdata.budget.discretionary = 1;
	
	sendMessage(pdata.model.actionSet[i].startMessage);
}

function applyEvents(pdata)
{
	for (var i=0;i<pdata.eventList.length;i++)
	{
		pdata.eventList[i].duringEffect(pdata);
	}
}

function applyStatus(pdata)
{
	for (var i=0;i<pdata.statusList.length;i++)
	{
		pdata.statusList[i].duringEffect(pdata);
	}
}

function addEvent(pdata, event)
{
	var evcopy = clone(event);
	
	pdata.eventList.push_back(evcopy);
}

function startEvents(pdata)
{
	for (var i=0;i<pdata.model.randomEventSet.length;i++)
	{
		if (pdata.model.randomEventSet[i].canTrigger(pdata))
			if (Math.random()*pdata.model.randomEventSet[i].chancePerYear * pdata.model.timeScale)
			{
				addEvent(pdata, pdata.model.randomEventSet[i]);
			}
	}
}

function iterateRCI(pdata)
{
	updateRCI(pdata, "economy", pdata.drift.economy * pdata.model.timeScale);
	updateRCI(pdata, "medicine", pdata.drift.medicine * pdata.model.timeScale);
	updateRCI(pdata, "environment", pdata.drift.environment * pdata.model.timeScale);
	updateRCI(pdata, "order", pdata.drift.order * pdata.model.timeScale);
}

function Iterate(pdata)
{
	iterateRCI(pdata);
	getGrowthFactors(pdata);
	updatePopulation(pdata);
	assignBudget(pdata);
	updateProject(pdata);
	startEvents(pdata);
	applyEvents(pdata);
	applyStatus(pdata);
}
