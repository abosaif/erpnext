frappe.provide("erpnext.pos");
{% include "erpnext/public/js/controllers/taxes_and_totals.js" %}

frappe.pages['pos'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Point of Sale',
		single_column: true
	});
	
	wrapper = $(wrapper).find('.page-content')
	new erpnext.pos.PointOfSale(page, wrapper)
}

erpnext.pos.PointOfSale = erpnext.taxes_and_totals.extend({
	init: function(page, wrapper){
		this.page = page;
		this.wrapper = wrapper;
		this.set_indicator();
		this.onload();
		this.make_menu_list();
		this.set_interval_for_si_sync();
		this.si_docs = this.get_doc_from_localstorage();
	},

	check_internet_connection: function(){
		var me = this;
		//Check Internet connection after every 30 seconds
		setInterval(function(){
			me.set_indicator();
		}, 30000)
	},

	set_indicator: function(){
		var me = this;
		// navigator.onLine
		this.page.set_indicator("Offline", "grey")
		frappe.call({
			method:"frappe.handler.ping",
			callback: function(r){
				if(r.message){
					me.connection_status = true;
					me.page.set_indicator("Online", "green")
				}
			}
		})
	},

	onload: function(){
		var me = this;

		this.get_data_from_server(function(){
			me.create_new(); 
		});
	
		this.check_internet_connection();
	},

	make_menu_list: function(){
		var me = this;

		this.page.add_menu_item(__("Unsync Records"), function(){
			me.show_unsync_invoice_list()
		});
	
		this.page.add_menu_item(__("Sync Master Data"), function(){
			me.get_data_from_server()
		});
	
		this.page.add_menu_item(__("New Sales Invoice"), function() {
			me.create_new()
		})
	},

	show_unsync_invoice_list: function(){
		var me = this;
		this.si_docs = this.get_doc_from_localstorage();

		this.list_dialog = new frappe.ui.Dialog({
			title: 'Invoice List'
		});
	
		this.list_dialog.show();
		this.list_body = this.list_dialog.body;
		$(this.list_body).append('<div class="row list-row list-row-head pos-invoice-list">\
				<div class="col-xs-6">Customer</div>\
				<div class="col-xs-3 text-right">Grand Total</div>\
				<div class="col-xs-3 text-right">Status</div>\
		</div>')

		$.each(this.si_docs, function(index, data){
			for(key in data) {
				$(frappe.render_template("pos_invoice_list", {
					name: key,
					customer: data[key].customer,
					grand_total: data[key].grand_total,
					status: (data[key].docstatus == 1) ? 'Submitted' : 'Draft'
				})).appendTo($(me.list_body));
			}
		})
	
		$(this.list_body).find('.list-row').click(function() {
			me.name = $(this).attr('invoice-name')
			doc_data = me.get_invoice_doc(me.si_docs)
			if(doc_data){
				me.frm.doc = doc_data[0][me.name];
				me.refresh();
				me.disable_input_field();
				me.list_dialog.hide();
			}
		})
	},

	get_invoice_doc: function(si_docs){
		var me = this;
		this.si_docs = this.get_doc_from_localstorage();

		return $.grep(this.si_docs, function(data){
			for(key in data){
				return key == me.name
			}
		}) 
	},

	get_data_from_server: function(callback){
		var me = this;
		frappe.call({
			method: "erpnext.accounts.doctype.sales_invoice.pos.get_pos_data",
			freeze: true,
			callback: function(r){
				window.items = r.message.items;
				window.customers = r.message.customers;
				window.pricing_rules = r.message.pricing_rules;
				window.meta = r.message.meta;
				window.print_template = r.message.print_template;
				localStorage.setItem('doc', JSON.stringify(r.message.doc));
				if(callback){
					callback();
				}
			}
		})
	},
	
	create_new: function(){
		this.frm = {}
		var me = this;
		this.name = '';
		this.frm.doc =  JSON.parse(localStorage.getItem('doc'))
		this.load_data();
		this.setup();
	},

	load_data: function(){
		this.items = window.items;
		this.customers = window.customers;
		this.pricing_rules = window.pricing_rules;

		$.each(window.meta, function(i, data){
			frappe.meta.sync(data)
		})

		this.print_template = frappe.render_template("print_template", 
			{content: window.print_template, title:"POS"})
	},

	setup: function(){
		this.wrapper.html(frappe.render_template("pos", this.frm.doc));
		this.set_transaction_defaults("Customer");
		this.make();
		this.set_primary_action();
	},

	set_transaction_defaults: function(party) {
		var me = this;
		this.party = party;
		this.price_list = (party == "Customer" ?
			this.frm.doc.selling_price_list : this.frm.doc.buying_price_list);
		this.price_list_field = (party == "Customer" ? "selling_price_list" : "buying_price_list");
		this.sales_or_purchase = (party == "Customer" ? "Sales" : "Purchase");
	},

	make: function() {
		this.make_search();
		this.make_customer();
		this.make_item_list();
		this.make_discount_field()
	},

	make_search: function() {
		var me = this;
		this.search = frappe.ui.form.make_control({
			df: {
				"fieldtype": "Data",
				"label": "Item",
				"fieldname": "pos_item",
				"placeholder": "Search Item"
			},
			parent: this.wrapper.find(".search-area"),
			only_input: true,
		});
	
		this.search.make_input();
		this.search.$input.on("keyup", function() {
			setTimeout(function() {
				me.items = me.get_items();
				me.make_item_list(); 
			}, 1000);
		});
	
		this.party_field = frappe.ui.form.make_control({
			df: {
				"fieldtype": "Data",
				"options": this.party,
				"label": this.party,
				"fieldname": this.party.toLowerCase(),
				"placeholder": this.party
			},
			parent: this.wrapper.find(".party-area"),
			only_input: true,
		});
	
		this.party_field.make_input();
	},

	make_customer: function() {
		var me = this;
	
		if(this.customers.length == 1){
			this.party_field.$input.val(this.customers[0].name);
			this.frm.doc.customer = this.customers[0].name;
		}
	
		this.party_field.$input.autocomplete({
			source: function (request, response) {
				me.customer_data = me.get_customers(request.term)
				response($.map(me.customer_data, function(data){
					return {label: data.name, value: data.name, 
						customer_group: data.customer_group, territory: data.territory}
				}))
			},
			change: function(event, ui){
				if(ui.item){
					me.frm.doc.customer = ui.item.label;
					me.frm.doc.customer_name = ui.item.customer_name;
					me.frm.doc.customer_group = ui.item.customer_group;
					me.frm.doc.territory = ui.item.territory;
				}else{
					me.frm.doc.customer = me.party_field.$input.val();
				}
				me.refresh();
			}
		})
	},

	get_customers: function(key){
		var me = this;
		key = key.toLowerCase()
		return $.grep(this.customers, function(data) {
			if(data.name.toLowerCase().match(key) || data.customer_name.toLowerCase().match(key)
					|| data.customer_group.toLowerCase().match(key)){
				return data
			}
		})
	},

	make_item_list: function() {
		var me = this;
		if(!this.price_list) {
			msgprint(__("Price List not found or disabled"));
			return;
		}

		me.item_timeout = null;
	
		var $wrap = me.wrapper.find(".item-list");
		me.wrapper.find(".item-list").empty();

		if (this.items) {
			$.each(this.items, function(index, obj) {
				if(index < 16){
					$(frappe.render_template("pos_item", {
						item_code: obj.name,
						item_price: format_currency(obj.price_list_rate, obj.currency),
						item_name: obj.name===obj.item_name ? "" : obj.item_name,
						item_image: obj.image ? "url('" + obj.image + "')" : null,
						color: frappe.get_palette(obj.item_name),
						abbr: frappe.get_abbr(obj.item_name)
					})).tooltip().appendTo($wrap);
				}
			});
		}
	
		if(this.items.length == 1){
			this.search.$input.val("");
			this.add_to_cart();
		}

		// if form is local then allow this function
		$(me.wrapper).find("div.pos-item").on("click", function() {
			me.customer_validate();
			if(me.frm.doc.docstatus==0) {
				me.items = me.get_items($(this).attr("data-item-code"))
				me.add_to_cart();
			}
		});
	},

	get_items: function(item_code){
		// To search item as per the key enter

		var me = this;
		this.item_serial_no = {}
	
		if(item_code){
			return $.grep(window.items, function(item){
				if(item.item_code == item_code ){
					return true
				}
			})
		}

		key = this.search.$input.val().toLowerCase();

		if(key){
			return $.grep(window.items, function(item){
				if( (item.item_code.toLowerCase().match(key)) ||
				(item.item_name.toLowerCase().match(key)) || (item.item_group.toLowerCase().match(key)) ){
					return true
				}else if(item.barcode){
					return item.barcode == me.search.$input.val()
				} else if (in_list(item.serial_nos, me.search.$input.val())){
					me.item_serial_no[item.item_code] = me.search.$input.val()
					return true
				}
			})
		}else{
			return window.items;
		}
	},

	update_qty: function() {
		var me = this;

		$(this.wrapper).find(".pos-item-qty").on("change", function(){
			var item_code = $(this).parents(".pos-bill-item").attr("data-item-code");
			me.update_qty_against_item_code(item_code, $(this).val());
		})
	
		$(this.wrapper).find("[data-action='increase-qty']").on("click", function(){
			var item_code = $(this).parents(".pos-bill-item").attr("data-item-code");
			var qty = flt($(this).parents(".pos-bill-item").find('.pos-item-qty').val()) + 1;
			me.update_qty_against_item_code(item_code, qty);
		})
	
		$(this.wrapper).find("[data-action='decrease-qty']").on("click", function(){
			var item_code = $(this).parents(".pos-bill-item").attr("data-item-code");
			var qty = flt($(this).parents(".pos-bill-item").find('.pos-item-qty').val()) - 1;
			me.update_qty_against_item_code(item_code, qty);
		})
	},

	update_qty_against_item_code: function(item_code, qty){
		var me = this;
		if(qty < 0){
			frappe.throw(__("Quantity must be positive"));
		}
	
		this.remove_item = []
		$.each(this.frm.doc["items"] || [], function(i, d) {
			if (d.item_code == item_code) {
				d.qty = flt(qty);
				d.amount = flt(d.rate) * flt(d.qty);
				if(d.qty==0){
					me.remove_item.push(d.idx)
				}
			}
		});
		this.remove_zero_qty_item();
		this.refresh();
	},

	remove_zero_qty_item: function(){
		var me = this;
		idx = 0
		this.items = []
		idx = 0
		$.each(this.frm.doc["items"] || [], function(i, d) {
			if(!in_list(me.remove_item, d.idx)){
				d.idx = idx;
				me.items.push(d);
				idx++; 
			}
		});
	
		this.frm.doc["items"] = this.items;
	},

	make_discount_field: function(){
		var me = this;

		this.wrapper.find('input.discount-percentage').on("change", function() {
			me.frm.doc.additional_discount_percentage = flt($(this).val(), precision("additional_discount_percentage"));
			total = me.frm.doc.grand_total
		
			if(me.frm.doc.apply_discount_on == 'Net Total'){
				total = me.frm.doc.net_total
			}
		
			me.frm.doc.discount_amount = flt(total*flt(me.frm.doc.additional_discount_percentage) / 100, precision("discount_amount"));
			me.wrapper.find('input.discount-amount').val(me.frm.doc.discount_amount)
			me.refresh();
		});

		this.wrapper.find('input.discount-amount').on("change", function() {
			me.frm.doc.discount_amount = flt($(this).val(), precision("discount_amount"));
			me.frm.doc.additional_discount_percentage = 0.0;
			me.wrapper.find('input.discount-percentage').val(0);
			me.refresh();
		});
	},

	customer_validate: function(){
		var me = this;
	
		if(!this.frm.doc.customer){
			frappe.throw(__("Please select customer"))
		}
	},

	add_to_cart: function() {
		var me = this;
		var caught = false;
		var no_of_items = me.wrapper.find(".pos-bill-item").length;

		this.validate_serial_no()
		this.validate_warehouse();

		if (no_of_items != 0) {
			$.each(this.frm.doc["items"] || [], function(i, d) {
				if (d.item_code == me.items[0].item_code) {
					caught = true;
					d.qty += 1;
					d.amount = flt(d.rate) * flt(d.qty)
					if(me.item_serial_no.length){
						d.serial_no += '\n' + me.item_serial_no[d.item_code]
					}
				}
			});
		}

		// if item not found then add new item
		if (!caught)
			this.add_new_item_to_grid();

		this.refresh();
	},

	add_new_item_to_grid: function() {
		var me = this;
		this.child = frappe.model.add_child(this.frm.doc, this.frm.doc.doctype + " Item", "items");
		this.child.item_code = this.items[0].item_code;
		this.child.item_name = this.items[0].item_name;
		this.child.stock_uom = this.items[0].stock_uom;
		this.child.description = this.items[0].description;
		this.child.qty = 1;
		this.child.item_group = this.items[0].item_group;
		this.child.cost_center = this.items[0].cost_center;
		this.child.income_account = this.items[0].income_account;
		this.child.warehouse = this.items[0].default_warehouse;
		this.child.price_list_rate = flt(this.items[0].price_list_rate, 9) / flt(this.frm.doc.conversion_rate, 9);
		this.child.rate = flt(this.items[0].price_list_rate, 9) / flt(this.frm.doc.conversion_rate, 9);
		this.child.actual_qty = this.items[0].actual_qty;
		this.child.amount = flt(this.child.qty) * flt(this.child.rate);
		this.child.serial_no = this.item_serial_no[this.child.item_code]; 
	},

	refresh: function() {
		var me = this;
		this.refresh_fields();
		this.update_qty();
		this.set_primary_action();
	},
	refresh_fields: function() {
		this.apply_pricing_rule();
		this.discount_amount_applied = false;
		this._calculate_taxes_and_totals();
		this.calculate_discount_amount();
		this.show_items_in_item_cart();
		this.set_taxes();
		this.calculate_outstanding_amount();
		this.set_totals();
	},
	
	get_company_currency: function() {
		return erpnext.get_currency(this.frm.doc.company);
	},
	
	show_item_wise_taxes: function(){
		return null;
	},
	
	show_items_in_item_cart: function() {
		var me = this;
		var $items = this.wrapper.find(".items").empty();
		me.frm.doc.net_total = 0.0
		$.each(this.frm.doc.items|| [], function(i, d) {
			$(frappe.render_template("pos_bill_item", {
				item_code: d.item_code,
				item_name: (d.item_name===d.item_code || !d.item_name) ? "" : ("<br>" + d.item_name),
				qty: d.qty,
				actual_qty: d.actual_qty,
				projected_qty: d.projected_qty,
				rate: format_currency(d.rate, me.frm.doc.currency),
				amount: format_currency(d.amount, me.frm.doc.currency)
			})).appendTo($items);
		});

		this.wrapper.find("input.pos-item-qty").on("focus", function() {
			$(this).select();
		});
	},

	set_taxes: function(){
		var me = this;
		me.frm.doc.total_taxes_and_charges = 0.0

		var taxes = this.frm.doc.taxes || [];
		$(this.wrapper)
			.find(".tax-area").toggleClass("hide", (taxes && taxes.length) ? false : true)
			.find(".tax-table").empty();
	
		$.each(taxes, function(i, d) {
			if (d.tax_amount && cint(d.included_in_print_rate) == 0) {
				$(frappe.render_template("pos_tax_row", {
					description: d.description,
					tax_amount: format_currency(flt(d.tax_amount_after_discount_amount),
						me.frm.doc.currency)
				})).appendTo(me.wrapper.find(".tax-table"));
			}
		});
	},

	set_totals: function() {
		var me = this;
		this.wrapper.find(".net-total").text(format_currency(me.frm.doc.total, me.frm.doc.currency));
		this.wrapper.find(".grand-total").text(format_currency(me.frm.doc.grand_total, me.frm.doc.currency));
	},

	set_primary_action: function() {
		var me = this;

		if (this.frm.doc.docstatus==0 && this.frm.doc.outstanding_amount > 0) {
			this.page.set_primary_action(__("Pay"), function() {
				me.validate()
				me.create_invoice();
				me.make_payment();
			});
		}else if(this.frm.doc.docstatus == 0){
			this.page.set_primary_action(__("Submit"), function() {
				frappe.confirm(__("Do you really want to submit the invoice?"), function () {
					me.write_off_amount()
				})
			})
		}else if(this.frm.doc.docstatus == 1){
			this.page.set_primary_action(__("Print"), function() {
				html = frappe.render(me.print_template, me.frm.doc)
				frappe.require("/assets/js/print_format_v3.min.js", function() {
					w = _p.preview(html);
					setTimeout(function(){
						w.print();
					}, 1000)
				});
			})
		}
	},
	
	write_off_amount: function(){
		var me = this; 
		var value = 0.0;

		if(this.frm.doc.outstanding_amount > 0){
			dialog = new frappe.ui.Dialog({
				title: 'Write Off Amount',
				fields: [
					{fieldtype: "Currency", fieldname: "write_off_amount", label: __("Amount"), reqd: 1},
				]
			  });
  
			  dialog.show();
			  
			  dialog.fields_dict.write_off_amount.$input.change(function(){
				  value = dialog.get_values()
			  })
			  
			  dialog.set_primary_action(__("Submit"), function(){
				  me.frm.doc.write_off_amount = value.write_off_amount;
				  me.calculate_outstanding_amount();
				  dialog.hide();
				  me.change_status();
			  })
		}else{
			me.change_status();
		}
	},
	
	change_status: function(){
		if(this.frm.doc.docstatus == 0){
			this.frm.doc.docstatus = 1;
			this.update_invoice();
			this.disable_input_field();
		}
	},

	disable_input_field: function(){
		var pointer_events = 'inherit'
		$(this.wrapper).find('input').attr("disabled", false);
	
		if(this.frm.doc.docstatus == 1){
			pointer_events = 'none'
			$(this.wrapper).find('input').attr("disabled", true);	
		}
	
		$(this.wrapper).find('.pos-bill-wrapper').css('pointer-events', pointer_events);
		$(this.wrapper).find('.pos-items-section').css('pointer-events', pointer_events);
		this.set_primary_action();
	},

	create_invoice: function(){
		var me = this;
		var invoice_data = {}
		this.si_docs = this.get_doc_from_localstorage();
		if(this.name){
			this.update_invoice()
		}else{
			this.name = $.now();
			invoice_data[this.name] = this.frm.doc
			this.si_docs.push(invoice_data)
			this.update_localstorage();
			this.set_primary_action();
		}
	},

	update_invoice: function(){
		var me = this;
		this.si_docs = this.get_doc_from_localstorage();
		$.each(this.si_docs, function(index, data){
			for(key in data){
				if(key == me.name){
					me.si_docs[index][key] = me.frm.doc
					me.update_localstorage();
				}
			}
		})
	},

	update_localstorage: function(){
		try{
			localStorage.setItem('sales_invoice_doc', JSON.stringify(this.si_docs));
		}catch(e){
			frappe.throw(__("LocalStorage is full , did not save"))
		}
	},

	get_doc_from_localstorage: function(){
		return JSON.parse(localStorage.getItem('sales_invoice_doc')) || [];
	},

	set_interval_for_si_sync: function(){
		var me = this;
		setInterval(function(){
			me.sync_sales_invoice()
		}, 6000)
	},

	sync_sales_invoice: function(){
		var me = this;
		this.si_docs = this.get_submitted_invoice()

		if(this.connection_status && this.si_docs.length){
			frappe.call({
				method: "erpnext.accounts.doctype.sales_invoice.pos.make_invoice",
				args: {
					doc_list: me.si_docs
				},
				callback: function(r){
					if(r.message){
						me.removed_items = r.message;
						me.remove_doc_from_localstorage();
					}
				}
			})
		}
	},

	get_submitted_invoice: function(){
		invoices = []
		docs = this.get_doc_from_localstorage()
		if(docs){
			invoices = $.map(docs, function(data){
				for(key in data){
					if(data[key].docstatus == 1){
						return data
					}
				}
			});
		}

		return invoices
	},

	remove_doc_from_localstorage: function(){
		var me = this;
		this.si_docs = this.get_doc_from_localstorage();
		if(this.removed_items){
			$.each(this.si_docs, function(index, data){
				for(key in data){
					if(in_list(me.removed_items, key)){			
						me.si_docs.splice(index)
					}
				}
			})
			this.update_localstorage();
		}
	},

	validate: function(){
		var me = this;
		this.customer_validate();
		this.item_validate();
	},

	item_validate: function(){
		if(this.frm.doc.items.length == 0){
			frappe.throw(__("Select items to save the invoice"))
		}
	},

	validate_serial_no: function(){
		var me = this;
		var item_code = serial_no = '';
		for (key in this.item_serial_no){
			item_code = key;
			serial_no = me.item_serial_no[key]
		}
	
		if(item_code && serial_no){
			$.each(this.frm.doc.items, function(index, data){
				if(data.item_code == item_code){
					if(in_list(data.serial_no.split('\n'), serial_no)){
						frappe.throw(__(repl("Serial no %(serial_no)s is already taken", {
							'serial_no': serial_no
						})))
					}
				}
			})
		}
	},

	apply_pricing_rule: function(){
		var me = this;
		$.each(this.frm.doc["items"], function(n, item) {
			pricing_rule = me.get_pricing_rule(item)
			me.validate_pricing_rule(pricing_rule)
			if(pricing_rule.length){
				item.margin_type = pricing_rule[0].margin_type;
				item.price_list_rate = pricing_rule[0].price || item.price_list_rate;
				item.margin_rate_or_amount = pricing_rule[0].margin_rate_or_amount;
				item.discount_percentage = pricing_rule[0].discount_percentage || 0.0;
				me.apply_pricing_rule_on_item(item)
			}
		})
	},

	get_pricing_rule: function(item){
		var me = this;
		return $.grep(this.pricing_rules, function(data){
			if(data.item_code == item.item_code || in_list(['All Item Groups', item.item_group], data.item_group)) {
				if(in_list(['Customer', 'Customer Group', 'Territory'], data.applicable_for)){
					return me.validate_condition(data)
				}else{
					return true
				}
			}
		})
	},

	validate_condition: function(data){
		//This method check condition based on applicable for
		condition = this.get_mapper_for_pricing_rule(data)[data.applicable_for]
		if(in_list(condition[1], condition[0])){
			return true
		}
	},

	get_mapper_for_pricing_rule: function(data){
		return {
			'Customer': [data.customer, [this.doc.customer]],
			'Customer Group': [data.customer_group, [this.doc.customer_group, 'All Customer Groups']],
			'Territory': [data.territory, [this.doc.territory, 'All Territories']],
		}
	},

	validate_pricing_rule: function(pricing_rule){
		//This method validate duplicate pricing rule
		var pricing_rule_name = '';
		var priority = 0;
		var pricing_rule_list = [];
		var priority_list = []

		if(pricing_rule.length > 1){
		
			$.each(pricing_rule, function(index, data){
				pricing_rule_name += data.name + ','				
				priority_list.push(data.priority)
				if(priority <= data.priority){
					priority = data.priority
					pricing_rule_list.push(data)
				}
			})
		
			count = 0
			$.each(priority_list, function(index, value){
				if(value == priority){
					count++
				}
			})

			if(priority == 0 || count > 1){
				frappe.throw(__(repl("Multiple Price Rules exists with same criteria, please resolve conflict by assigning priority. Price Rules: %(pricing_rule)s", {
					'pricing_rule': pricing_rule_name
				})))
			}
		
			return pricing_rule_list
		}
	},
	
	validate_warehouse: function(){
		if(!this.items[0].default_warehouse){
			frappe.throw(__("Deafault warehouse is required for selected item"))
		}
	}
})