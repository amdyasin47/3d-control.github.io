var socket
var printer_status, printer_sub_status
var socket_status
var current_minute                            = getCurrentHHMM()
var debug_mode                                = true
var receiving_file_list_mode                  = false
var printer_file_list                         = []
var periodicalTimer, lapsedTimer
var printing_start_time                       = 0
var printing_file_size                        = -1

// defaults
var settings_baud                             = "115200"
var settings_regx_temperature_hotend_current  = new RegExp("T:([0-9]{1,3}).[0-9]{1,3} \\/[0-9]{1,3}.[0-9]{1,3}")
var settings_regx_temperature_hotend_set      = new RegExp("T:[0-9]{1,3}.[0-9]{1,3} \\/([0-9]{1,3}).[0-9]{1,3}")
var settings_regx_temperature_bed_current     = new RegExp("B:([0-9]{1,3}).[0-9]{1,3} \\/[0-9]{1,3}.[0-9]{1,3}")
var settings_regx_temperature_bed_set         = new RegExp("B:[0-9]{1,3}.[0-9]{1,3} \\/([0-9]{1,3}).[0-9]{1,3}")

var settings_regx_position_x                  = new RegExp("X:([0-9]{1,3}.[0-9]{1,2})")
var settings_regx_position_y                  = new RegExp("Y:([0-9]{1,3}.[0-9]{1,2})")
var settings_regx_position_z                  = new RegExp("Z:([0-9]{1,3}.[0-9]{1,2})")

var settings_regx_printing_filename           = new RegExp("File opened: (.*) Size:.*")
var settings_regx_sd_print_process            = new RegExp("SD printing byte ([0-9]{1,10})\\/([0-9]{1,10})")
var settings_regx_sd_print_time               = new RegExp("Print time:(.*)")
var settings_regx_print_end                   = new RegExp("Done printing file")
var settings_regx_print_start                 = new RegExp("File selected")
var settings_regx_print_not_printing          = new RegExp("Not SD printing")
var settings_regx_printer_busy                = new RegExp("(.*)busy(.*)processing")
var settings_regx_printer_homing              = new RegExp("(.*)MrDIY_Homing(.*)")
var settings_regx_printer_bed_leveling        = new RegExp("(.*)MrDIY_ABL(.*)")
var settings_regx_printer_heating             = new RegExp("(.*)MrDIY_Heating(.*)")
var settings_regx_printer_is_printing         = new RegExp("(.*)MrDIY_Printing(.*)")

var settings_regx_printing_feedrate           = new RegExp("FR:(.*)%")
var settings_regx_printing_flow               = new RegExp(".*Flow: (.*)%")

var settings_regx_file_list_start             = new RegExp("Begin file list")
var settings_regx_file_list_end               = new RegExp("End file list")
var settings_regx_file_list_parser            = new RegExp("(.*) (.*)")
var settings_regx_file_list_parser_3          = new RegExp("(.*) (.*) (.*)")
var settings_regx_file_open                   = new RegExp("Current file: (.*)")

var settings_regx_printer_stats               = new RegExp("Stats: (.*)")
var settings_regx_printer_firmware            = new RegExp("FIRMWARE_NAME:(.*arlin.*)\\(.*")

var settings_periodical_commands              = "M105;temperatures\nM114;positions\nM27 C;current file"
var settings_printing_commands                = "M31;printtime\nM27;progress\nM220;feed\nM221;flow"
var settings_on_boot_commands                 = settings_periodical_commands + "\n" + settings_printing_commands
var settings_periodical_commands_interval     = 30
var settings_print_commands                   = "M23 FILENAME\nM24; print\nM117 New job started"
var settings_pause_commands                   = "M25;pause\nM117 Pause requested"
var settings_stop_commands                    = "M0;stop\nM108;\nM112;\nM117 Stop requested"

var sd_files_loaded = false
var features_loaded = false
var socket_url = null

/* ------------------------------------------- onStart ------------------------------------ */     
        
$(document).ready(function () {

  const params = new URLSearchParams(window.location.search)
  if(params.has('network') === true) socket_url = params.get('network')
  else window.location.replace("setup.html")
   
  changePrinterStatus('reset')
  changeTab('home')
  
  //$('#mrdiy_divider').height($(document).innerHeight() )
  //$('.mrdiy_divider').css("background-color", "#32C5FF")
  var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
  var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl)
  })
  
  if(settings_periodical_commands_interval < 30) settings_periodical_commands_interval = 30
  
  periodicalTimer = window.setInterval( function(){ triggerPeriodicalCommands() }, settings_periodical_commands_interval*1000)
  lapsedTimer = window.setInterval( function(){ triggerTimerUpdate() }, 1000)
  window.onresize = updateUI

  $('#cmd_reboot').click(function(event){
        sendOverSocket("{'action':'command','content':998}" )
        $('body').html("<p style='margin:10px'>Please <a href='/'>refresh</a> the page in 10 seconds.</p>")
  })

  $('#console_input').keypress(function(event){
    var keycode = (event.keyCode ? event.keyCode : event.which)
    if(keycode == '13'){
        sendOverSocket("{'action':'console','content':'" + $("#console_input").val() + "'}" ) 
        $('#console_input').val("")
     }
  })

  $('#console_input_send_button').click(function(event){
      if($("#console_input").val() != ""){
        sendOverSocket("{'action':'console','content':'" + $("#console_input").val() + "'}" )
        $('#console_input').val("")
      }
  })

  $('.nav-link').click(function(event){
      if( ! $(event.target).attr('id') ) return
      event.preventDefault()
      changeTab($(event.target).attr('id'))
      if( $(event.target).attr('id') == "sd_card") fetchSDCardContent()
      else if( $(event.target).attr('id') == "features") fetchFeaturesContent()
  })

  $('#action_show_sd_card').click(function(event){
      changeTab("sd_card")
      fetchSDCardContent()
  }) 

  $('#action_refresh_sd_card').click(function(event){ 
       fetchSDCardContent(true)
  }) 

  $('.settings_field').on('input', function(event) {
      sendOverSocket( "{'action':'settings', 'command':'update', 'key':'" + $(event.target).attr('id').replace("settings_", "")  + "',  'value':'" + $( "#" + $(event.target).attr('id') ).val() + "'}" )
      if( $(event.target).attr('id').includes("regx") ) window[ $(event.target).attr('id') ] = new RegExp( $( "#" + $(event.target).attr('id') ).val())
      else window[ $(event.target).attr('id') ] = $( "#" + $(event.target).attr('id') ).val()
      $(".alert_settings_changed").show()
  })

  $('.settings_changed_button').click(function(event){
      sendOverSocket( "{'action':'settings', 'command':'commit'}" )
      $('.settings_changed_button').html("Saving")
  })

  $('#action_pause').click(function(event){
    if (confirm("Pause the print?")) { 
        var cs = settings_pause_commands.split("\n")
        $.each(cs, function(k,v){
               sendOverSocket( "{'action':'console', 'content':'"+(v.split(";")[0])+"'}" )
        })
    }
  })
  
  $('#action_stop').click(function(event){
    if (confirm("Stop the print?")) {  
        var cs = settings_stop_commands.split("\n")
        $.each(cs, function(k,v){
               sendOverSocket( "{'action':'console', 'content':'"+(v.split(";")[0])+"'}" )
        })
    }
  })

  connectToSocket()
})

function changeTab(id){
  
      if( !id ) return
      $(".a_tab").addClass('hidden_forced')
      $(".nav-link" ).removeClass('active')
      $("#" + id ).addClass('active')
      $("#tab_" + id ).removeClass('hidden_forced')
      updateUI( $("#tab_" + id ).height() )
}

function updateUI(height){

      $("body").width($(window).width()-4)
      //if( height > 0 ) $('#mrdiy_divider').height(height)
      //$("#tabs").height($(window).height())
      $("#feed_url").height($("#temps_chart").height())
      $("#tab_console").height($(window).height())
}

function fetchSDCardContent(force){

    if( force == true || sd_files_loaded == false){
      sendOverSocket( "{'action':'console', 'content':'M20L'}" )
      sd_files_loaded = true
    }
}

function fetchFeaturesContent(force){

    if( force == true || features_loaded == false){
      sendOverSocket( "{'action':'console', 'content':'M115'}" )
      sendOverSocket( "{'action':'console', 'content':'M78'}" )
      features_loaded = true
    }
}

function connectToSocket(){
  
   if( typeof socket !== 'undefined' && socket.readyState == 1 ) return
   printToJSConsole("[socket] connecting to ws://" + location.host + ":8000")
   $('#current_file_name').html(socket_url)
   socket = new WebSocket("ws://" + socket_url + ":8000")
   changeSocketStatus("connecting")

   /* --------------------------------- Socket ------------------------------------ */      

  socket.onopen = function(e) {
    printToJSConsole("[socket] Connected")
    changeSocketStatus("active")
    sendCommandsOnConnect()
  }

  socket.onmessage = function(event) {

    changeSocketStatus("active")
    printToJSConsole("[socket] " + event.data)
     try {
        var jsonObject = JSON.parse(event.data)        
    } catch(e) {
        printToJSConsole("[jsonObject] error" + e)
        return
    }       
    var data_type = jsonObject.type
    
    /* -------------------------- Printer console ------------------------------ */ 
        
    if(data_type == "console"){
      $('#console_output').append(jsonObject.content) 
      $('#console_output').append('\n') 
      $('#console_output').scrollTop($('#console_output')[0].scrollHeight)  
      processMessage(jsonObject.content)  
    
    /* ----------------------------- Settings  ---------------------------------- */
    
    } else if(data_type == "settings"){
      
      if( jsonObject.key && $('#settings_' + jsonObject.key ).exists() ){
          $('#settings_' + jsonObject.key).attr('maxlength',jsonObject.maxlength )
          $('#settings_' + jsonObject.key ).val(jsonObject.value)
          if(jsonObject.value || jsonObject.value !=""){
              if(jsonObject.key.includes("regx"))  window[ 'settings_' + jsonObject.key ] = new RegExp(jsonObject.value)
              else window[ 'settings_' + jsonObject.key ] = jsonObject.value
          }else{
              if( jsonObject.key && jsonObject.key.includes("regx")) $('#settings_' + jsonObject.key).attr('placeholder', window[ 'settings_' + jsonObject.key ].source )            
          }
          $('#settings_on_boot_commands').attr('placeholder', settings_on_boot_commands )
          $('#settings_periodical_commands').attr('placeholder', settings_periodical_commands )
          $('#settings_periodical_commands_interval').attr('placeholder', settings_periodical_commands_interval )
          $('#settings_baud').attr('placeholder', settings_baud )
          $('#settings_print_commands').attr('placeholder', settings_print_commands )
          $('#settings_pause_commands').attr('placeholder', settings_pause_commands )
          $('#settings_stop_commands').attr('placeholder',  settings_stop_commands )
      }
      else if(jsonObject.key == "baud")  updateUIBaud( jsonObject.value )

     /* ----------------------------- Info  ---------------------------------- */     
    } else if(data_type == "info"){
      
        $('#info_wifi').html( getWifiSignalStrength(jsonObject.wifi) + "%" )
        $('#info_ip_address').html( jsonObject.ip_address )
        $('#info_mac_address').html( jsonObject.mac_address )
        $('#info_version').html( jsonObject.version )

     /* ----------------------------- Errors  ---------------------------------- */     
    }else if(data_type == "error"){
      
      var c = $('.mrdiy_divider').css("background-color")
      $('.mrdiy_divider').css("background-color", "#ffc107")
      setTimeout(() => {  $('.mrdiy_divider').css("background-color", c) }, 1000)
      
    }else if(data_type == "ack"){
      
      if( jsonObject.content == "commited" ){
          $(".settings_changed_button").html("Saved")
          setTimeout(function() { 
              $(".alert_settings_changed").hide()             
              $('.settings_changed_button').html("Save")
           }, 1000)
      }
    }
  }

  socket.onclose = function(event) {
    if (event.wasClean) {
      printToJSConsole("[socket] socket.onclose")
    } else {
      printToJSConsole("[socket] Connection died")
    }
    changeSocketStatus("closed")
  }

  
  socket.onerror = function(event) {
      printToJSConsole("[socket] socket.onerror ")
      printToJSConsole(event)
      changeSocketStatus("closed")
  }

}

function processMessage(msg){
  
        if(msg) msg = msg.trim()
        else return

        /* ---------------------------- Files list -------------------------------------------------- */
        
        if( settings_regx_file_list_end.test(msg) ){
          
            receiving_file_list_mode = false
            $('#action_refresh_sd_card_loading').hide()
            $('#action_refresh_sd_card_do').show()
            if( printer_file_list.length == 0 ){
              $("#print_files_list").hide()
              $('#sd_card_has_no_files').show()
            }else{
              $('#sd_card_has_no_files').hide()
              $("#print_files_list").show()
            }
            $('.action_print').click(function(event){
               if( $(event.target).attr('filename') == "" ) return
               if (confirm("Print " + $(event.target).attr('filename')  + "?")) {  
                    var cs = settings_print_commands.replaceAll("FILENAME", $(event.target).attr('filename') )
                    var cs = cs.split("\n")
                    $.each(cs, function(k,v){
                       sendOverSocket( "{'action':'console', 'content':'"+(v.split(";")[0])+"'}" )
                    })
                    changeTab('home')
                }
                return false
            })
            return      
        }       
        if( settings_regx_file_list_start.test(msg) ){
            receiving_file_list_mode = true
            printer_file_list.length = 0
            $("#print_files_list").html("")
            return       
        }
       if( receiving_file_list_mode == true ){
            if( !msg.includes(".GCO") || msg.includes("TRASHE")) return
            if( settings_regx_file_list_parser_3.test(msg)){
              var file = settings_regx_file_list_parser_3.exec(msg)
              if( parseInt(file[2]) == 0 ) return// empty file
              if( file[3] ) f = file[3]//.replace(".gcode", "")
              else f = file[1]
              $("#print_files_list").append(  "<li class='list-group-item-deleted border-bottom p-2 d-flex justify-content-between align-items-center'>"
                                        + "   <span class='col-6 col-md-10 text-secondary overflow-hidden small ps-3'>" + f + "</span>"
                                        + "   <span class='col-3 col-md-1 text-secondary text-end small'>" + readableSize(parseInt(file[2])) + "</span>"
                                        + "   <span class='col-3 col-md-1 text-end'><button type='button' class='action_print btn text-mrdiy-light' filename='" + file[1] + "'><svg class='bi' width='20' height='20'> <use xlink:href='#print_icon'></use></svg></button></span>"                                   
                                        + "</li>")
            }else{
              var file = settings_regx_file_list_parser.exec(msg)
              if( parseInt(file[2]) == 0 ) return// empty file
              $("#print_files_list").append(  "<li class='list-group-item-deleted border-bottom p-2 d-flex justify-content-between align-items-center'>"
                                        + "   <span class='col-6 col-md-10 text-secondary overflow-hidden small ps-3'>" + file[1] + "</span>"
                                        + "   <span class='col-3 col-md-1 text-secondary text-end small'>" + readableSize(parseInt(file[2])) + "</span>"
                                        + "   <span class='col-3 col-md-1 text-end'><button type='button' class='action_print btn text-mrdiy-light' filename='" + file[1] + "'><svg class='bi' width='16' height='16'> <use xlink:href='#print_icon'></use></svg></button></span>"                                   
                                        + "</li>")              
            }  
           printer_file_list[printer_file_list.length] = msg                       
           return     
        }
        
        /* ---------------------------- MOVEMENTS -------------------------------------------------- */
       
        if( settings_regx_position_x.test(msg) ){
            var a = settings_regx_position_x.exec(msg)
            var x_position  = parseInt(a[1])
            position_chart.data.datasets[0].data[position_chart.data.datasets[0].data.length-1]["x"] = x_position
            position_chart.update()         
        }

        if( settings_regx_position_y.test(msg) ){
            var a = settings_regx_position_y.exec(msg)
            var y_position  = parseInt(a[1])
            position_chart.data.datasets[0].data[position_chart.data.datasets[0].data.length-1]["y"] = y_position
            position_chart.update()         
        }
        
        if( settings_regx_position_z.test(msg) ){
            var a = settings_regx_position_z.exec(msg)
            $('#printing_z_height').html( parseInt(a[1]) )
        }

        if( settings_regx_printing_flow.test(msg) ){
            var a = settings_regx_printing_flow.exec(msg)
            $('#printing_flow').html( parseInt(a[1]) )
        }

        if( settings_regx_printing_feedrate.test(msg) ){
            var a = settings_regx_printing_feedrate.exec(msg)
            $('#printing_feedrate').html( parseInt(a[1]) )
        }      
        /* ------------------------- Hotend (current) ----------------------------------------- */
        
        if( settings_regx_temperature_hotend_current.test(msg) ){          
            var value  = parseInt(settings_regx_temperature_hotend_current.exec(msg)[1])
            if( value >= 0 &&  value < 400){
                var set_value = parseInt( $('#set_hotend_temperature').html() )
                $('#current_hotend_temperature').html(value)      
                last_timestamp = temps_chart.data.datasets[0].data[temps_chart.data.datasets[0].data.length-1]["x"]
                if( last_timestamp == getCurrentHHMM() ) temps_chart.data.datasets[1].data[temps_chart.data.datasets[1].data.length-1]["y"] = value
                else temps_chart.data.datasets[1].data.push( {x:getCurrentHHMM(),y:value} )
                temps_chart.update()               
            }
        }

        /* ------------------------- Bed (current) ----------------------------------------- */
        
        if( settings_regx_temperature_bed_current.test(msg) ){          
            var value  = parseInt(settings_regx_temperature_bed_current.exec(msg)[1])
            if( value >= 0 &&  value < 400){
                var set_value = parseInt( $('#set_bed_temperature').html() )
                $('#current_bed_temperature').html(value)      
                last_timestamp = temps_chart.data.datasets[0].data[temps_chart.data.datasets[0].data.length-1]["x"]
                if( last_timestamp == getCurrentHHMM() ) temps_chart.data.datasets[0].data[temps_chart.data.datasets[0].data.length-1]["y"] = value
                else temps_chart.data.datasets[0].data.push( {x:getCurrentHHMM(),y:value} )
                temps_chart.update()   
            }
        }
                
        /* ------------------------- Hotend (set) ----------------------------------------- */
        
        if( settings_regx_temperature_hotend_set.test(msg) ){ 
            var value  = parseInt(settings_regx_temperature_hotend_set.exec(msg)[1])
            if( value >= 0 &&  value < 400) {         
              $('#set_hotend_temperature').html(value)   
            }   
        }

        /* ------------------------- Bed (set) ------------------------------------------- */
        
        if( settings_regx_temperature_bed_set.test(msg) ){          
            var value  = parseInt(parseInt(settings_regx_temperature_bed_set.exec(msg)[1]))
            if( value >= 0 &&  value < 400){
              $('#set_bed_temperature').html(value)               
            }
        }
        
        /* ---------------------------- Print time ------------------------------------------ */
        
        if( settings_regx_sd_print_time.test(msg)){
          
            var value  = settings_regx_sd_print_time.exec(msg)

            if (/([0-9]{1,3})d ([0-9]{1,3})h ([0-9]{1,3})m ([0-9]{1,3})s/.test(value)){
              
              time_pieces = /([0-9]{1,3})d ([0-9]{1,3})h ([0-9]{1,3})m ([0-9]{1,3})s/.exec(msg)
              var s = parseInt(time_pieces[4])
              var m = parseInt(time_pieces[3])
              var h = parseInt(time_pieces[2])
              var d = parseInt(time_pieces[1])
              printing_start_time = Date.now() - (s + m*60 + h*60*60 + d*24*60*60)*1000
              printToJSConsole( "dhms"+ printing_start_time)
              //changePrinterStatus('printing')
              //changePrinterSubStatus('printing')  
              
            }else if(/([0-9]{1,3})h ([0-9]{1,3})m ([0-9]{1,3})s/.test(value)){

              time_pieces = /([0-9]{1,3})h ([0-9]{1,3})m ([0-9]{1,3})s/.exec(value)
              var s = parseInt(time_pieces[3])
              var m = parseInt(time_pieces[2])
              var h = parseInt(time_pieces[1])
              printing_start_time = Date.now() - (s + m*60 + h*60*60)*1000
              printToJSConsole( "hms"+ printing_start_time)
              //changePrinterStatus('printing')
              //changePrinterSubStatus('printing')  

            }else if(/([0-9]{1,3})m ([0-9]{1,3})s/.test(value)){

              time_pieces = /([0-9]{1,3})m ([0-9]{1,3})s/.exec(value)
              var s = parseInt(time_pieces[2])
              var m = parseInt(time_pieces[1])
              printing_start_time = Date.now() - (s + m*60)*1000 
              printToJSConsole( "ms"+ printing_start_time)
              //changePrinterStatus('printing')
              //changePrinterSubStatus('printing')  
                          
            }else if(/([0-9]{1,3})s/.test(value)){

              time_pieces = /([0-9]{1,3})s/.exec(value)
              var s = parseInt(time_pieces[1])
              printing_start_time = Date.now() - s*1000
              printToJSConsole( "s"+ printing_start_time) 
              //if( s > 0) changePrinterStatus('printing')
                          
            }else{         
                       
              printing_start_time = 0
              $('#timer_lapsed').html(value[1]) 
              printToJSConsole( "no match")      
            }  
        }

         /* ----------------------- Print Filename ------------------------------------------- */
         
         if( settings_regx_printing_filename.test(msg) ){          
            var value  = settings_regx_printing_filename.exec(msg)[1].trim().toLowerCase()
            if( value.includes("gco") ) $('#current_file_name').html(value)
            changePrinterStatus('printing') 
            changePrinterSubStatus('printing')  
        }       

         /* ----------------------- Open Filename ------------------------------------------- */
         
         if( settings_regx_file_open.test(msg) ){          
            var value  = settings_regx_file_open.exec(msg)[1]
            if( value.trim() == '(no file)') return
            if( value.includes("gcode") ) $('#current_file_name').html(value.split(' ')[1].trim().toLowerCase()) // long name support
            else $('#current_file_name').html(value.trim().toLowerCase())  // short name only available
            changePrinterStatus('printing') 
            changePrinterSubStatus('printing')  
        }    
        
        /* --------------------------- Print done  --------------------------------------------- */
        
        if( settings_regx_print_end.test(msg) ){
            changePrinterStatus('done')                
        }  

        /* -------------------------- Print started  -------------------------------------------- */
        
         if( settings_regx_print_start.test(msg) ){
            changePrinterStatus('printing')
            changePrinterSubStatus('printing')  
            $('#timer_lapsed').html(' ') 
            $('#current_file_process').html('') 
        }               

        /* -------------------------- Print process: SD Card ----------------------------------- */
        
         if( settings_regx_sd_print_process.test(msg) ){  
            var p = settings_regx_sd_print_process.exec(msg)
            var percentage = (p[1] / p[2] * 100) | 0
            printing_file_size  = p[2]
            $('#current_file_process').html( readableSize(parseInt(p[1])) + " / " + readableSize(parseInt(p[2])) )       
            if(percentage >= 0 && percentage <= 100) {
              if(percentage == 0 ) percentage = 0.1
              $('#progress-bar').removeClass()
              $('#progress-bar').css('width', percentage+'%').attr('aria-valuenow', percentage)
              $('#progress-bar').addClass("progress-bar progress-bar-striped progress-bar-animated")
              $('#progress-bar').html(percentage+'%')
              changePrinterStatus('printing') 
              changePrinterSubStatus('printing')  
            }
        }   

        /* ------------------------------ Is Printing ------------------------------------------------- */
        
        if( settings_regx_printer_is_printing.test(msg) ){
            changePrinterStatus('printing')  
            changePrinterSubStatus('printing')         
        } 

        /* ------------------------------ Is NOT Printing ------------------------------------------------- */
        
        if( settings_regx_print_not_printing.test(msg) ){
            changePrinterStatus('notprinting')          
        } 

        /* ------------------------------ Is Bed Leveling------------------------------------------------- */
        
        if( settings_regx_printer_bed_leveling.test(msg) ){
            changePrinterSubStatus('abl')          
        } 

        /* ------------------------------ Is Bed Homing------------------------------------------------- */
        
        if( settings_regx_printer_homing.test(msg) ){
            changePrinterSubStatus('homing')          
        } 

             /* ------------------------------ Is Heating------------------------------------------------- */
        
        if( settings_regx_printer_heating.test(msg) ){
            changePrinterSubStatus('heating')          
        } 

        /* ------------------------------ Firmware ------------------------------------------------- */

        if( settings_regx_printer_firmware.test(msg) ){
            var f = settings_regx_printer_firmware.exec(msg)
            $('#info_firmware').html(f[1]) 
            $('#info_firmware').parent().show()
        } 

        /* ------------------------------ Printer Stats ------------------------------------------------- */

        if( settings_regx_printer_stats.test(msg) ){
            if( $('#info_stats').html().indexOf("Filament") != -1 )  $('#info_stats').html("")
            $('#info_stats').parent().show() 
            msg = msg.replace("Stats: ", "")
            $('#info_stats').html( $('#info_stats').html() + msg + "<br />")      
        } 

        /* ------------------------------ Printer Busy ------------------------------------------------- */

        if( settings_regx_printer_busy.test(msg) ){
            showLoadingIndicator()
        }else{
            hideLoadingIndicator()
        }
}


/* --------------------------------- UI Charts ------------------------------------ */   
   
var temps_chart = new Chart($('#temps_chart'), {
    type: 'line',
    data: {
        labels: [current_minute],
        datasets: [{
            data: [{x:0,y:0}],
            backgroundColor: ['rgba(255, 99, 132, 0.2)' ],
            borderColor: [ 'rgba(255, 99, 132, 1)' ],
            borderWidth: 1
        },
        {
            data: [{x:current_minute,y:0}],
            backgroundColor: ['rgba(44, 130, 201, 1)' ],
            borderColor: [ 'rgba(44, 130, 201, 1)'],
            borderWidth: 1
        }
        ]
    },
    options: {
      responsive: true,
      plugins: {
                  legend: {  position: 'NONE' }   
              },  
      scales: {
                  y: { beginAtZero: true, max: 250,label:false,ticks: { callback: function(val){return val +'°C';} } }
              }
    }
})

temps_chart.options.animation = false
var ptx = $('#position_chart')
var position_chart = new Chart(ptx, {
    type: 'scatter',
    data: {
        labels: [current_minute],
        datasets: [ { data: [{x:0,y:0,z:0}] , borderColor: [ 'rgba(255, 99, 132, 1)' ]  }]
    },
    options: {
      responsive: true,
      plugins: {
                  legend: {  position: 'NONE' }   
                },  
      scales: { 
                x: {  beginAtZero: true, max: 200, ticks: { callback: function(val, index){return val;} } },
                y: {  beginAtZero: true, max: 200, ticks: { callback: function(val, index){return val;} } } 
               }
    }
})
position_chart.options.animation = false

/* ------------------------------------ Tools -------------------------------------- */     

function changeSocketStatus(new_socket_status){
  // connecting, active, dead
  switch(socket_status) {

    case "connecting":
        if( new_socket_status == "active") socketIsActive()
        else if( new_socket_status == "closed") socketIsDead()
      break

    case "active":
        if( new_socket_status == "connecting") socketIsConnecting()
        else if( new_socket_status == "closed") socketIsDead()
      break

    default:
      if( new_socket_status == "connecting") socketIsActive()
  } 
}

function socketIsActive(){

  socket_status = "active"
  changePrinterStatus("idle")
  $('.mrdiy_divider').css("background-color", "#32C5FF")
  $('#progress-bar').removeClass()
  $('#progress-bar').css('width', '100%').attr('aria-valuenow', 100)
  $('#progress-bar').addClass("progress-bar")
  triggerTimerUpdate()
}

function socketIsConnecting(){
  
  $('#printer_status').html("connecting")
  $('#printer_status').removeClass()
  $('#printer_status').css("color","#ffc107")
  $('.mrdiy_divider').css("background-color", "#ffc107")
  $('#progress-bar').removeClass("text-mrdiy-light")
  $('#progress-bar').css('width', '100%').attr('aria-valuenow', 100)
  $('#progress-bar').css("background-color","#ffc107")
  $('#progress-bar').removeClass()
  $('#progress-bar').addClass("progress-bar-striped progress-bar-animated")
  showLoadingIndicator()
  
}

function socketIsDead(){

  $('#printer_status').html("offline")
  $('.mrdiy_divider').css("background-color", "#c42535")
  $('#printer_status').removeClass("text-mrdiy-light")
  $('#printer_status').addClass("text-mrdiy-red")
  $('#current_file_name').html("refresh the page to reconnect")
  $('#progress-bar').removeClass("text-mrdiy-light")
  $('#progress-bar').css('width', '100%').attr('aria-valuenow', 100)
  $('#progress-bar').css("background-color","#c42535")
  $('#progress-bar').removeClass()
  $('#timer_lapsed').html('')
  $('#progress-bar').html('')
  hideLoadingIndicator()
  clearInterval(periodicalTimer) 
  clearInterval(lapsedTimer) 
}

function changePrinterSubStatus(new_sub_status){

  if(printer_sub_status == new_sub_status) return
  if( new_sub_status == "homing") $('#printer_status').html("Homing")
  else if( new_sub_status == "abl") $('#printer_status').html("A.B.L.")
  else if( new_sub_status == "heating") $('#printer_status').html("Heating")
  else {$('#printer_status').html("printing"); hideLoadingIndicator(); return; }
  $('#current_file_name').html("this might take a bit")
  showLoadingIndicator()
}

function changePrinterStatus(new_status){
  // idle, printing, done
  // printing, notprinting, done, reset
  if( new_status == "reset"){ printerIsIdle(); return; }

  switch(printer_status) {

    case "idle":
        if( new_status == "printing") printerIsPrinting()
        break;

    case "printing":
        if( new_status == "notprinting") printerIsDone()
        else if( new_status == "done") printerIsDone()
        else changePrinterSubStatus("printing")
        break;

    case "done":
        if( new_status == "printing") printerIsPrinting()
        break;

    default:
        if( new_status == "printing") printerIsPrinting()
  } 
}

function printerIsPrinting(){

    printer_status = "printing"
    $('#printer_status').html(printer_status)
    //$('#current_file_name').html("getting filename")
    sendOverSocket( "{'action':'console', 'content':'M27 C'}" ) 
    $('#printer_status').removeClass()
    $('#printer_status').addClass("text-mrdiy-light text-capitalize")
    $('#progress-bar').removeClass()
		$('#progress-bar').addClass("progress-bar")
    $('#action_pause').attr("disabled", false)
    $('#action_stop').attr("disabled", false)
}

function printerIsDone(){

    printer_status = "done"
    $('#printer_status').html(printer_status)
    $('#printer_status').removeClass()
    $('#printer_status').addClass("text-mrdiy-green text-capitalize")
    $('#current_file_process').html("")
    $('#progress-bar').html("100%")
    $('#progress-bar').removeClass()
		$('#progress-bar').addClass("progress-bar bg-mrdiy-green")
		$('#progress-bar').css('width', '100%').attr('aria-valuenow', 100)

    $('#action_pause').attr("disabled", true)
    $('#action_stop').attr("disabled", true)  
    // stop the timer and show duration
}

function printerIsIdle(){

    printer_status = "idle"
    $('#printer_status').html(printer_status)
    $('#printer_status').removeClass()
    $('#printer_status').addClass("text-mrdiy-light text-capitalize")

    $('#timer_lapsed').html('') 
    $('#progress-bar').html('')

    $('#progress-bar').removeClass()
    $('#progress-bar').addClass("progress-bar") 
    $('#progress-bar').css('width', '100%').attr('aria-valuenow', 100)

    $('#action_pause').attr("disabled", true)
    $('#action_stop').attr("disabled", true)
}

function sendCommandsOnConnect(){
  
      sendOverSocket( "{'action':'command', 'content':100}" )         // get settings
      sendOverSocket( "{'action':'command', 'content':101}" )         // get info
      var i = 0
      setTimeout(function() {
              var cs = settings_on_boot_commands.split("\n")
              $.each(cs, function(k,v){
                 setTimeout(function() { sendOverSocket( "{'action':'console', 'content':'"+(v.split(";")[0])+"'}" ) }, i++ * 300)
              })
        }, 3000)
}

function triggerPeriodicalCommands(){
  
  var pc = settings_periodical_commands.split("\n")
  $.each(pc, function(k,v){
         sendOverSocket( "{'action':'console', 'content':'"+(v.split(";")[0])+"'}" )
  })
  if(isPrinting()){
    var prc = settings_printing_commands.split("\n")
    $.each(prc, function(k,v){
      sendOverSocket( "{'action':'console', 'content':'"+(v.split(";")[0])+"'}" )
    })
  }
}

function triggerTimerUpdate(){
  
   if(!isPrinting()) return
   if( printing_start_time > 0) $('#timer_lapsed').html( getdhmsFormat( (Date.now() - printing_start_time)/1000 | 0 ) )
}

function getdhmsFormat(secs){
  
    var sec_num = secs
    var days = Math.floor(sec_num / 60 / 60 /24) % 60
    var hours = Math.floor(sec_num / 60 / 60) % 60
    var minutes = Math.floor(sec_num / 60) % 60
    var seconds = sec_num % 60
    if(days>0) return days + "d " + hours + "h " + minutes + "m "// + seconds + "s"  // 1m 40s
    else if(hours>0) return hours + "h " + minutes + "m " + seconds + "s"  // 1m 40s
    else if(minutes>0) return minutes + "m " + seconds + "s"
    else return seconds + "s" 
}

function readableSize(a, b, c, d, e) {
  
    return (b = Math, c = b.log, d = 1000, e = c(a) / c(d) | 0, a / b.pow(d, e)).toFixed(0) + '' + (e ? 'KMG' [--e] + 'B' : 'B')
}

function getCurrentHHMM(){
  
  var dt = new Date()
  m = dt.getMinutes()
  if(m<10) m = "0" + m
  if(dt.getSeconds() < 30) s = "00"
  else s = "30"
  return dt.getHours() + ":" + m
}

function printToJSConsole(msg){
  
  if( debug_mode ) console.log(msg)
}

function sendOverSocket(msg){
  
  printToJSConsole( "[out] " + msg)
  if (socket.readyState == 1)   socket.send(msg)
}

function isPrinting(){
  
  return printer_status == 'printing'
}

function showLoadingIndicator(){

  $('#busy_box').addClass('spinner') 
  //$('#current_file_name').css("margin-left", "25px")   
}

function hideLoadingIndicator(){
    
    $('#busy_box').removeClass('spinner')
    //$('#current_file_name').css("margin-left", "0")
}

function getWifiSignalStrength(v) { 
    
  m = -50
  d = -122
  return ((100 * (m - d) * (m - d) - (m - v) * (15 * (m - d) + 62 * (m - v))) / ((m - d) * (m - d)))| 0
}

function changeBaud(){

    baud = document.getElementById("baud").value
    sendOverSocket( "{'action':'settings','command':'update','key':'baud','value':'"+baud+"'}" ) 
}

function updateUIBaud(baud){

  var current_baud = document.getElementById("baud").value
  if( current_baud == baud ) return
  $('#baud option[value="'+baud+'"]').prop('selected', true)
}

jQuery.fn.exists = function(){return this.length>0;}
