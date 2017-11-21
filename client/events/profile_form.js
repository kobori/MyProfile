Template.profileForm.events({

  "submit form": function(e, template){
    e.preventDefault();
    var name = $("#nome").val();
    var about = $("#perfil").val();
    $('#name').focus()
    Meteor.call("profileUpdate", name, about)


    Session.set("editProfile", false);
  }

});