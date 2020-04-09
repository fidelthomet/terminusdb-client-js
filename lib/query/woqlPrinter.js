/**
 * Class responsible for converting a JSON WOQL into a WOQL.js string
 */
function WOQLPrinter(vocab, language){
	this.vocab = vocab
	this.language = language
	this.indent_spaces = 4
	this.boxed_predicates = ["woql:value", "woql:variable", "woql:node", "woql:arithmetic_value"]
	this.subject_cleaned_predicates = ["woql:subject", "woql:element"]
	this.schema_cleaned_predicates = ["woql:predicate", "woql:parent", "woql:child", "woql:uri", 'woql:of_type']
	this.list_operators = ["ValueList", "Array", "NamedAsVar", "IndexedAsVar", "AsVar"]
	this.query_list_operators = ["And", "Or"]
	this.operator_maps = {
		IDGenerator: "idgen",
		IsA: "isa",
		PostResource:  "post",
		FileResource: "file", 
		RemoteResource: "remote",
		AsVars: "as",
		NamedAsVars: "as",
		IndexedAsVars: "as"
	}
	this.shortcuts = {	
		optional : "opt",
		substring: "substr",
		regexp: "re",
		subsumption: "sub", 
		equals: "eq",
		concatenate: "concat"
	}
	this.pythonic = {
		and: "woql_and",
		or: "woql_or",
		as: "woql_as",
		with: "woql_with",
		from: "woql_from",
		not: "woql_not"
	}
	this.show_context = false
}

WOQLPrinter.prototype.printJSON = function(json, level, fluent, newline){
	level = level || 0
	fluent = fluent || false
	let str = ""
	if(!json["@type"]){
		console.log("Bad structure passed to print json, no type: ", json)
		return false;
	}
	if(json['@type'] == "woql:Variable"){
		return this.pvar(json)
	}
	else if(typeof json['@value'] != "undefined"){
		return this.plit(json)
	}
	let operator = json["@type"].split(":")[1]
	if(operator){
		let ujson = this.unboxJSON(operator, json)
		if(ujson){
			return this.printArgument(operator, this.getBoxedPredicate(operator, json), ujson, level, fluent)
		}
		if(this.isListOperator(operator)){
			str += "["
		}
		else {
			let call = this.getFunctionForOperator(operator)
			let indent = (newline ? level * this.indent_spaces : 0)
			str += this.getWOQLPrelude(call, fluent, indent) + "("
		}
		//below needs to be changed to have a specific ordering
		let args = this.getArgumentOrder(operator, json)
		for(var i = 0; i<args.length; i++){
			let nfluent = ((args[i] == "woql:query" && operator != "When") || args[i] == "woql:consequent") ? true : false;
			str += this.printArgument(operator, args[i], json[args[i]], level, nfluent)
			let divlimit = args.indexOf("woql:query") == -1 ? args.length-1 : args.length - 2
			if(i < divlimit) str += ", "
		}
		if(this.isListOperator(operator)) str += "]"
		else {
			if(this.argumentTakesNewline(operator)) str += "\n" + nspaces(level*this.indent_spaces)
			if(!fluent) str += ")"
		}
	}
	else {
		console.log("wrong structure passed to print json ", json)
	}
	return str
}

WOQLPrinter.prototype.getArgumentOrder = function(operator, json){
	let args = Object.keys(json);
	args.splice(args.indexOf("@type"), 1)
	return args;
}

WOQLPrinter.prototype.argumentTakesNewline = function(operator){
	return (this.isQueryListOperator(operator))	
}

WOQLPrinter.prototype.printArgument = function(operator, predicate, arg, level, fluent){
	let str = "";
	if(fluent) str += ")"
	let newline = this.argumentTakesNewline(operator)
	if(newline) str += "\n" + nspaces((level+1) * this.indent_spaces)
	if(predicate == "woql:document") return JSON.stringify(arg)
	if(Array.isArray(arg)){
		let arr_entries = [];
		for(var j = 0; j<arg.length; j++){
			let nlevel = (newline ? level +1 : level)
			arr_entries.push(this.printJSON(arg[j], nlevel, fluent, newline) )
		}
		let jstr = (newline ? ",\n" + nspaces(++level*this.indent_spaces) : ",")
		str += arr_entries.join(jstr)
	}	
	else if(typeof arg == "object"){
		//if(newline) str += "\n" + nspaces(level*this.indent_spaces)
		str += this.printJSON(arg, level, fluent) 
	}
	else if(typeof arg == "string"){
		str += this.uncleanArgument(arg, operator, predicate)
	}
	return str
}

WOQLPrinter.prototype.plit = function(json){
	if(json["@type"] == "xsd:string"  || json["@type"] =="xsd:anyURI" || json['@language']) {
		let cnt = json["@value"]
		if(cnt.indexOf("\n") != -1) return '`' + cnt + '`'
		return '"' + cnt + '"'
	}
	if(json["@type"] == "xsd:decimal" || json["@type"] == "xsd:boolean" || 
	json["@type"] == "xsd:integer" ||  json["@type"] == "xsd:nonNegativeInteger") return json["@value"]
	return JSON.stringify(json)
}

WOQLPrinter.prototype.pvar = function(json){
	if(json['woql:variable_name'] && typeof json['woql:variable_name']['@value'] != "undefined"){
		let varname = json['woql:variable_name']['@value'];
		if(varname.indexOf(":") == -1){
			varname = "v:" + varname
		}
		return '"' +  varname + '"'
	}
	return false
}

/**
 * Gets the starting characters for a WOQL query - varies depending on how the query is invoked and how indented it is
 */
WOQLPrinter.prototype.getWOQLPrelude = function(operator, fluent, inline){
	if(operator === "true" || operator === "false"){
		if(this.language == "python"){
			return operator.charAt(0).toUpperCase() + operator.slice(1);
		}
		return operator

	}
	let prelude = "WOQL."
	if(this.language == "python"){
		this.pythonic[operator] && (operator = this.pythonic[operator])
		prelude = "WOQLQuery()."
	}
	if(fluent){
		return "." + operator;
	}
	return (inline ? "\n" + nspaces(inline) : "") + prelude + operator;
}



WOQLPrinter.prototype.uncleanArgument = function(arg, operator, predicate){
	if(arg.indexOf(":") != -1){
		//is it a short cut? 
		for(var s in this.vocab){
			if(this.vocab[s] == arg) return '"' +  s + '"'
		}
		//is there a default reverse mapping
		if(this.subject_cleaned_predicates.indexOf(predicate) != -1){
			if(arg.substring(0,4) == "doc:") arg = arg.substring(4)
		}
		if(this.schema_cleaned_predicates.indexOf(predicate) != -1){
			if(arg.substring(0,4) == "scm:") arg = arg.substring(4)
		}
	}
	return '"' + arg + '"'
}




WOQLPrinter.prototype.isListOperator = function(operator){
	return (this.list_operators.indexOf(operator) != -1)
}

WOQLPrinter.prototype.isQueryListOperator = function(operator){
	return (this.query_list_operators.indexOf(operator) != -1)
}


WOQLPrinter.prototype.getFunctionForOperator = function(operator){
	if(this.operator_maps[operator]) return this.operator_maps[operator]
	else {
		let f = camelToSnake(operator);
		if(this.shortcuts[f]) return this.shortcuts[f]
		return f
	}
}


WOQLPrinter.prototype.getBoxedPredicate = function(operator, json){
	for(var i = 0; i<this.boxed_predicates.length; i++){
		if(json[this.boxed_predicates[i]]){
			return this.boxed_predicates[i];
		}
	}
	if(operator == "QueryListElement"){
		return "woql:query"
	}
	return false
}

WOQLPrinter.prototype.unboxJSON = function(operator, json){
	let bp = this.getBoxedPredicate(operator, json)
	if(bp){
		return json[bp]
	}
	return false
}

function camelToSnake(string) {
	return string.replace(/[\w]([A-Z])/g, function(m) {
		return m[0] + "_" + m[1];
	}).toLowerCase();
}

function nspaces(n){
	let spaces = "";
	for(var i = 0; i<n; i++){
		spaces += " ";
	}
	return spaces;
}


module.exports = WOQLPrinter;